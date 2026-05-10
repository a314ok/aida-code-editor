export type AidaCommandContext = {
  dispatch: (event: string, detail?: unknown) => void;
};

export type AidaCommandContribution = {
  id: string;
  title: string;
  shortcut?: string;
  run: (context: AidaCommandContext) => void | Promise<void>;
};

export type AidaExtensionManifest = {
  id: string;
  name: string;
  version?: string;
  contributes?: {
    commands?: AidaCommandContribution[];
  };
  activate?: (context: AidaExtensionContext) => void | Promise<void>;
};

export type AidaExtensionContext = {
  commands: {
    register: (command: AidaCommandContribution) => void;
    all: () => AidaCommandContribution[];
  };
  events: {
    dispatch: (event: string, detail?: unknown) => void;
  };
};

const extensions = new Map<string, AidaExtensionManifest>();
const commands = new Map<string, AidaCommandContribution>();

const commandContext: AidaCommandContext = {
  dispatch: (event, detail) => {
    window.dispatchEvent(new CustomEvent(event, { detail }));
  },
};

const extensionContext: AidaExtensionContext = {
  commands: {
    register: (command) => {
      commands.set(command.id, command);
      window.dispatchEvent(new CustomEvent('aida:extensions-changed'));
    },
    all: () => [...commands.values()],
  },
  events: {
    dispatch: commandContext.dispatch,
  },
};

export const registerExtension = async (manifest: AidaExtensionManifest) => {
  if (!manifest.id.trim()) throw new Error('Extension id is required');
  extensions.set(manifest.id, manifest);
  for (const command of manifest.contributes?.commands ?? []) {
    extensionContext.commands.register(command);
  }
  await manifest.activate?.(extensionContext);
  window.dispatchEvent(new CustomEvent('aida:extensions-changed'));
};

export const getExtensionCommands = () => [...commands.values()];

export const runExtensionCommand = async (id: string) => {
  const command = commands.get(id);
  if (!command) return false;
  await command.run(commandContext);
  return true;
};

export const getExtensions = () => [...extensions.values()];

declare global {
  interface Window {
    aida?: {
      registerExtension: typeof registerExtension;
      getExtensions: typeof getExtensions;
      getExtensionCommands: typeof getExtensionCommands;
    };
  }
}

if (typeof window !== 'undefined') {
  window.aida = {
    ...(window.aida ?? {}),
    registerExtension,
    getExtensions,
    getExtensionCommands,
  };
}
