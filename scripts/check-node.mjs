// Plain JS on purpose: it must run on an old Node, before anything else, and fail with a human message.
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  console.error(`\nTenant Message Copilot needs Node.js 22.12 or newer. You have v${process.versions.node}.\n` +
    `  Windows:  winget install OpenJS.NodeJS.LTS      (then open a NEW terminal)\n` +
    `  Or:       download the LTS installer from https://nodejs.org\n  Check:    node --version\n`);
  process.exit(1);
}
