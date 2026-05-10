import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./aida-ts-node-loader.mjs', pathToFileURL(`${import.meta.dirname}/`));
