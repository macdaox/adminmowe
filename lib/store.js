const fs = require('fs/promises');
const path = require('path');

const STORE_PATH = process.env.STORE_PATH
  ? path.resolve(process.env.STORE_PATH)
  : path.resolve(__dirname, '..', 'data', 'store.json');

let memory = null;
let writeQueue = Promise.resolve();

async function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

async function readFromDisk() {
  try {
    const raw = await fs.readFile(STORE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    throw e;
  }
}

async function writeToDisk(next) {
  await ensureDir(STORE_PATH);
  const content = JSON.stringify(next, null, 2);
  await fs.writeFile(STORE_PATH, content, 'utf8');
}

async function loadStore() {
  if (memory) return memory;
  const disk = await readFromDisk();
  if (disk) {
    memory = disk;
    return memory;
  }
  const seedPath = path.resolve(__dirname, '..', 'data', 'store.seed.json');
  const seedRaw = await fs.readFile(seedPath, 'utf8');
  const seed = JSON.parse(seedRaw);
  memory = seed;
  await writeToDisk(seed);
  return memory;
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

async function getStore() {
  const store = await loadStore();
  return deepClone(store);
}

async function updateStore(mutator) {
  writeQueue = writeQueue.then(async () => {
    const current = await loadStore();
    const cloned = deepClone(current);
    const next = await mutator(cloned);
    const finalValue = next && typeof next === 'object' ? next : cloned;
    memory = finalValue;
    await writeToDisk(finalValue);
    return true;
  });
  await writeQueue;
  return getStore();
}

module.exports = {
  STORE_PATH,
  getStore,
  updateStore
};

