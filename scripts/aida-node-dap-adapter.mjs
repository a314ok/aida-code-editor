#!/usr/bin/env node
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let dapSeq = 1;
let inputBuffer = Buffer.alloc(0);
let inspectSeq = 1;
let socket = null;
let debuggee = null;
let launchArgs = null;
let launchMode = false;
let inspectorUrlResolver = null;
let inspectorUrlRejecter = null;
let currentFrames = [];
let frameRefs = new Map();
let variableRefs = new Map();
let nextVariableRef = 1;
const inspectorCallbacks = new Map();
const sourceBreakpoints = new Map();
const adapterDir = path.dirname(fileURLToPath(import.meta.url));
const scriptUrls = new Map();

const send = (message) => {
  const json = JSON.stringify({ seq: dapSeq++, ...message });
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
};

const respond = (request, body = {}, success = true, message = undefined) => {
  send({
    type: 'response',
    request_seq: request.seq,
    command: request.command,
    success,
    message,
    body,
  });
};

const sendEvent = (event, body = {}) => {
  send({ type: 'event', event, body });
};

const output = (category, text) => {
  if (!text) return;
  sendEvent('output', { category, output: text });
};

const fail = (request, error) => {
  respond(request, {}, false, error instanceof Error ? error.message : String(error));
};

const pathFromUrl = (url) => {
  try {
    if (url?.startsWith('file://')) return fileURLToPath(url);
  } catch {}
  return url || 'unknown';
};

const sourceForUrl = (url) => {
  const filePath = pathFromUrl(url);
  return {
    name: path.basename(filePath),
    path: filePath,
  };
};

const readMessages = () => {
  while (inputBuffer.length) {
    const headerEnd = inputBuffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return;

    const header = inputBuffer.slice(0, headerEnd).toString('utf8');
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      inputBuffer = inputBuffer.slice(headerEnd + 4);
      continue;
    }

    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (inputBuffer.length < bodyEnd) return;

    const body = inputBuffer.slice(bodyStart, bodyEnd).toString('utf8');
    inputBuffer = inputBuffer.slice(bodyEnd);
    handleDapMessage(JSON.parse(body)).catch((error) => {
      output('stderr', `${error instanceof Error ? error.stack : String(error)}\n`);
    });
  }
};

process.stdin.on('data', (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  readMessages();
});

process.stdin.on('end', () => {
  shutdownDebuggee();
});

const inspect = (method, params = {}, timeout = 5000) => new Promise((resolve, reject) => {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    reject(new Error('Inspector is not connected'));
    return;
  }

  const id = inspectSeq++;
  const timer = setTimeout(() => {
    inspectorCallbacks.delete(id);
    reject(new Error(`${method} timed out`));
  }, timeout);

  inspectorCallbacks.set(id, { resolve, reject, timer });
  socket.send(JSON.stringify({ id, method, params }));
});

const handleInspectorMessage = (raw) => {
  const message = JSON.parse(typeof raw === 'string' ? raw : String(raw));
  if (message.id) {
    const callback = inspectorCallbacks.get(message.id);
    if (!callback) return;
    clearTimeout(callback.timer);
    inspectorCallbacks.delete(message.id);
    if (message.error) callback.reject(new Error(message.error.message ?? 'Inspector request failed'));
    else callback.resolve(message.result ?? {});
    return;
  }

  if (message.method === 'Debugger.scriptParsed') {
    if (message.params?.scriptId && message.params?.url) {
      scriptUrls.set(message.params.scriptId, message.params.url);
    }
  } else if (message.method === 'Debugger.paused') {
    currentFrames = message.params?.callFrames ?? [];
    frameRefs = new Map();
    variableRefs = new Map();
    nextVariableRef = 1;
    const reason = message.params?.reason === 'Break on start' ? 'entry' : message.params?.reason ?? 'pause';
    sendEvent('stopped', { reason, threadId: 1, allThreadsStopped: true });
  } else if (message.method === 'Debugger.resumed') {
    sendEvent('continued', { threadId: 1, allThreadsContinued: true });
  }
};

const connectInspector = (url) => new Promise((resolve, reject) => {
  socket = new WebSocket(url);
  socket.addEventListener('open', () => resolve());
  socket.addEventListener('message', (event) => handleInspectorMessage(event.data));
  socket.addEventListener('error', () => reject(new Error(`Could not connect to ${url}`)), { once: true });
  socket.addEventListener('close', () => {
    for (const callback of inspectorCallbacks.values()) {
      clearTimeout(callback.timer);
      callback.reject(new Error('Inspector disconnected'));
    }
    inspectorCallbacks.clear();
  });
});

const setupInspector = async (url) => {
  await connectInspector(url);
  await inspect('Runtime.enable');
  await inspect('Debugger.enable');
  await inspect('Debugger.setPauseOnExceptions', { state: 'none' }).catch(() => null);
};

const waitForInspectorUrl = () => new Promise((resolve, reject) => {
  inspectorUrlResolver = resolve;
  inspectorUrlRejecter = reject;
  setTimeout(() => reject(new Error('Timed out waiting for Node inspector URL')), 8000);
});

const consumeInspectorUrl = (text) => {
  const match = text.match(/ws:\/\/[^\s]+/);
  if (!match || !inspectorUrlResolver) return;
  inspectorUrlResolver(match[0]);
  inspectorUrlResolver = null;
  inspectorUrlRejecter = null;
};

const wireDebuggee = (child) => {
  child.stdout?.on('data', (chunk) => output('stdout', chunk.toString()));
  child.stderr?.on('data', (chunk) => {
    const text = chunk.toString();
    output('stderr', text);
    consumeInspectorUrl(text);
    if (text.includes('Waiting for the debugger to disconnect')) {
      try {
        socket?.close();
      } catch {}
    }
  });
  child.on('error', (error) => output('stderr', `${error.message}\n`));
  child.on('exit', (code, signal) => {
    sendEvent('exited', { exitCode: code ?? 0 });
    sendEvent('terminated', { restart: false, signal });
  });
};

const shutdownDebuggee = () => {
  try {
    socket?.close();
  } catch {}
  socket = null;
  if (debuggee && !debuggee.killed) {
    try {
      debuggee.kill();
    } catch {}
  }
  debuggee = null;
};

const startLaunchSession = async (args) => {
  shutdownDebuggee();
  const runtimeExecutable = args.runtimeExecutable || process.execPath;
  const cwd = args.cwd || (args.program ? path.dirname(path.resolve(args.program)) : process.cwd());
  const runtimeArgs = Array.isArray(args.runtimeArgs) ? args.runtimeArgs.map(String) : [];
  const programArgs = Array.isArray(args.args) ? args.args.map(String) : [];
  const childArgs = ['--inspect-brk=0', ...runtimeArgs];
  const programPath = args.program ? path.resolve(cwd, args.program) : null;

  if (programPath && /\.[cm]?tsx?$/i.test(programPath)) {
    childArgs.push(
      '--enable-source-maps',
      '--import',
      pathToFileURL(path.join(adapterDir, 'aida-ts-node-register.mjs')).href,
    );
  }

  if (programPath) {
    childArgs.push(programPath, ...programArgs);
  } else if (runtimeArgs.length === 0) {
    throw new Error('Node launch requires a program or runtimeArgs');
  } else {
    childArgs.push(...programArgs);
  }

  debuggee = spawn(runtimeExecutable, childArgs, {
    cwd,
    env: { ...process.env, ...(args.env ?? {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  wireDebuggee(debuggee);
  const url = await waitForInspectorUrl();
  await setupInspector(url);
  sendEvent('initialized');
};

const discoverInspectorUrl = (host, port) => new Promise((resolve, reject) => {
  const request = http.get({ host, port, path: '/json/list' }, (response) => {
    let body = '';
    response.setEncoding('utf8');
    response.on('data', (chunk) => { body += chunk; });
    response.on('end', () => {
      try {
        const targets = JSON.parse(body);
        const target = targets.find((item) => item.webSocketDebuggerUrl);
        if (!target) reject(new Error('No inspectable Node target found'));
        else resolve(target.webSocketDebuggerUrl);
      } catch (error) {
        reject(error);
      }
    });
  });
  request.on('error', reject);
  request.setTimeout(5000, () => {
    request.destroy(new Error('Inspector discovery timed out'));
  });
});

const startAttachSession = async (args) => {
  shutdownDebuggee();
  const url = args.webSocketUrl || args.url || await discoverInspectorUrl(args.address || '127.0.0.1', Number(args.port || 9229));
  await setupInspector(url);
  sendEvent('initialized');
};

const removeOldBreakpoints = async (sourcePath) => {
  const old = sourceBreakpoints.get(sourcePath) ?? [];
  sourceBreakpoints.set(sourcePath, []);
  for (const breakpointId of old) {
    await inspect('Debugger.removeBreakpoint', { breakpointId }).catch(() => null);
  }
};

const handleSetBreakpoints = async (request) => {
  const args = request.arguments ?? {};
  const sourcePath = args.source?.path;
  if (!sourcePath) {
    respond(request, { breakpoints: [] });
    return;
  }

  await removeOldBreakpoints(sourcePath);
  const url = pathToFileURL(path.resolve(sourcePath)).href;
  const breakpoints = [];
  const ids = [];
  for (const bp of args.breakpoints ?? []) {
    const requestedLine = Number(bp.line || 1);
    try {
      const result = await inspect('Debugger.setBreakpointByUrl', {
        url,
        lineNumber: Math.max(0, requestedLine - 1),
        columnNumber: Math.max(0, Number(bp.column || 1) - 1),
      });
      if (result.breakpointId) ids.push(result.breakpointId);
      const location = result.locations?.[0];
      breakpoints.push({
        verified: true,
        line: location ? location.lineNumber + 1 : requestedLine,
        column: location ? location.columnNumber + 1 : 1,
      });
    } catch (error) {
      breakpoints.push({
        verified: false,
        line: requestedLine,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  sourceBreakpoints.set(sourcePath, ids);
  respond(request, { breakpoints });
};

const makeVariableRef = (value) => {
  if (!value?.objectId) return 0;
  const ref = nextVariableRef++;
  variableRefs.set(ref, value.objectId);
  return ref;
};

const valueText = (value) => {
  if (!value) return 'undefined';
  if (Object.prototype.hasOwnProperty.call(value, 'value')) return String(value.value);
  if (value.description) return String(value.description);
  return value.type || 'unknown';
};

const handleStackTrace = (request) => {
  const start = Number(request.arguments?.startFrame ?? 0);
  const levels = Number(request.arguments?.levels ?? currentFrames.length);
  const selected = currentFrames.slice(start, start + levels);
  const stackFrames = selected.map((frame, index) => {
    const id = start + index + 1;
    frameRefs.set(id, frame);
    return {
      id,
      name: frame.functionName || '(anonymous)',
      source: sourceForUrl(frame.url || scriptUrls.get(frame.location?.scriptId)),
      line: (frame.location?.lineNumber ?? 0) + 1,
      column: (frame.location?.columnNumber ?? 0) + 1,
    };
  });
  respond(request, { stackFrames, totalFrames: currentFrames.length });
};

const handleScopes = (request) => {
  const frame = frameRefs.get(Number(request.arguments?.frameId));
  if (!frame) {
    respond(request, { scopes: [] });
    return;
  }

  const scopes = (frame.scopeChain ?? []).map((scope, index) => ({
    name: scope.name || scope.type || `scope ${index + 1}`,
    variablesReference: makeVariableRef(scope.object),
    expensive: scope.type === 'global',
  }));
  respond(request, { scopes });
};

const handleVariables = async (request) => {
  const objectId = variableRefs.get(Number(request.arguments?.variablesReference));
  if (!objectId) {
    respond(request, { variables: [] });
    return;
  }

  const result = await inspect('Runtime.getProperties', {
    objectId,
    ownProperties: false,
    accessorPropertiesOnly: false,
    generatePreview: true,
  });

  const variables = (result.result ?? [])
    .filter((property) => property.enumerable || property.isOwn || property.name === 'this')
    .slice(0, 250)
    .map((property) => ({
      name: property.name,
      type: property.value?.type,
      value: valueText(property.value),
      variablesReference: makeVariableRef(property.value),
    }));
  respond(request, { variables });
};

const handleDapMessage = async (request) => {
  if (request.type !== 'request') return;

  try {
    switch (request.command) {
      case 'initialize':
        respond(request, {
          supportsConfigurationDoneRequest: true,
          supportsRestartRequest: true,
          supportsSetVariable: false,
          supportsEvaluateForHovers: false,
          supportsStepBack: false,
        });
        break;
      case 'launch':
        launchMode = true;
        launchArgs = request.arguments ?? {};
        await startLaunchSession(launchArgs);
        respond(request);
        break;
      case 'attach':
        launchMode = false;
        await startAttachSession(request.arguments ?? {});
        respond(request);
        break;
      case 'setBreakpoints':
        await handleSetBreakpoints(request);
        break;
      case 'configurationDone':
        if (launchMode) await inspect('Runtime.runIfWaitingForDebugger').catch(() => null);
        respond(request);
        break;
      case 'threads':
        respond(request, { threads: [{ id: 1, name: 'Node main thread' }] });
        break;
      case 'stackTrace':
        handleStackTrace(request);
        break;
      case 'scopes':
        handleScopes(request);
        break;
      case 'variables':
        await handleVariables(request);
        break;
      case 'continue':
        await inspect('Debugger.resume');
        respond(request, { allThreadsContinued: true });
        break;
      case 'pause':
        await inspect('Debugger.pause');
        respond(request);
        break;
      case 'next':
        await inspect('Debugger.stepOver');
        respond(request);
        break;
      case 'stepIn':
        await inspect('Debugger.stepInto');
        respond(request);
        break;
      case 'stepOut':
        await inspect('Debugger.stepOut');
        respond(request);
        break;
      case 'restart':
        if (!launchArgs) throw new Error('Restart is only available after launch');
        await startLaunchSession(launchArgs);
        respond(request);
        break;
      case 'disconnect':
        shutdownDebuggee();
        respond(request);
        sendEvent('terminated');
        break;
      default:
        respond(request, {}, false, `Unsupported DAP command: ${request.command}`);
    }
  } catch (error) {
    fail(request, error);
  }
};
