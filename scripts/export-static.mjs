import { spawn } from "node:child_process"
import { access, rename, rm } from "node:fs/promises"
import path from "node:path"

const root = process.cwd()
const api = path.join(root, "src/app/api")
const hidden = path.join(root, "src/app/_api_hold")

async function exists(target) {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

if (await exists(hidden)) {
  throw new Error("src/app/_api_hold already exists; the last static export did not finish.")
}

await rm(path.join(root, ".next"), { recursive: true, force: true })
await rename(api, hidden)
try {
  const code = await new Promise((resolve) => {
    const child = spawn("npx", ["next", "build"], {
      stdio: "inherit",
      env: { ...process.env, OUTPUT_EXPORT: "1" },
    })
    child.on("exit", resolve)
  })
  if (code !== 0) throw new Error(`next build exited ${code}`)
} finally {
  await rename(hidden, api)
}
