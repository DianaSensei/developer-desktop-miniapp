import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makePluginConfig } from '../../scripts/makePluginConfig.mjs';

export default makePluginConfig(path.dirname(fileURLToPath(import.meta.url)));
