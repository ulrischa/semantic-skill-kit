// Create independent knowledge projects without overwriting existing files. Created for Uli.
import path from 'node:path';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { defaults } from './config.mjs';
export async function initProject(destination) {
  const root = path.resolve(destination);
  await mkdir(root,{recursive:true});
  if ((await readdir(root)).length) throw Error('init requires a new or empty directory.');
  const name = path.basename(root).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,63).replace(/-$/,'') || 'my-guidance';
  await mkdir(path.join(root,'knowledge'));
  await writeFile(path.join(root,'skill-kit.json'),JSON.stringify({...defaults,name},null,2)+'\n');
  await writeFile(path.join(root,'knowledge','example.md'),'---\nid: example\ndescription: Example document explaining how to replace the knowledge base.\ntags: [knowledge, setup]\n---\n\n# Replace the knowledge base\n\nReplace this file with your own Markdown documents. Nested folders are supported. Set the skill name and description in skill-kit.json. Run build, then search.\n');
  await writeFile(path.join(root,'.gitignore'),'.cache/\n.skill-kit/\ndist/\nnode_modules/\n');
  return root;
}
