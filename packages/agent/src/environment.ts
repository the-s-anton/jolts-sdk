import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export function installEnvironment(
  directory: string,
  token: string,
  endpoint: string,
  previousDigest?: string,
): string {
  if (!/^[a-f0-9]{64}$/.test(token)) {
    throw new Error("Invalid setup credential.");
  }
  if (!/^https?:\/\/[^\s'"\\`$#]+$/.test(endpoint)) {
    throw new Error("Invalid setup endpoint.");
  }
  const root = projectRoot(directory);
  const file = join(root, ".env.local");
  let descriptor: number;
  try {
    descriptor = openSync(
      file,
      constants.O_RDWR | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW,
      0o600,
    );
  } catch {
    throw new Error(".env.local must be a writable regular file.");
  }
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 65536) {
      throw new Error(".env.local must be a small, unlinked regular file.");
    }
    const existing = readFileSync(descriptor, "utf8");
    if (previousDigest !== undefined) {
      const entries = [...existing.matchAll(/^JOLTS_API_KEY=([a-f0-9]{64})$/gm)];
      const endpoints = [...existing.matchAll(/^JOLTS_ENDPOINT=(.+)$/gm)];
      const previous = entries[0]?.[1];
      if (
        !previous ||
        entries.length !== 1 ||
        endpoints.length !== 1 ||
        existing.match(/^\s*(?:export\s+)?JOLTS_API_KEY\s*=/gm)?.length !== 1 ||
        existing.match(/^\s*(?:export\s+)?JOLTS_ENDPOINT\s*=/gm)?.length !== 1 ||
        endpoints[0]?.[1] !== endpoint ||
        createHash("sha256").update(previous).digest("hex") !== previousDigest
      ) {
        throw new Error("The existing connection does not match this replacement.");
      }
      const gitDirectory = spawnSync("git", ["-C", root, "rev-parse", "--absolute-git-dir"], {
        encoding: "utf8",
      });
      if (gitDirectory.status !== 0) throw new Error("The project must be a Git repository.");
      const temporary = join(
        gitDirectory.stdout.trim(),
        `jolts-${randomBytes(16).toString("hex")}.tmp`,
      );
      const output = openSync(
        temporary,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
        0o600,
      );
      try {
        writeFileSync(
          output,
          existing.replace(`JOLTS_API_KEY=${previous}`, `JOLTS_API_KEY=${token}`),
        );
        fsyncSync(output);
        const current = lstatSync(file);
        if (
          current.ino !== stat.ino ||
          current.dev !== stat.dev ||
          current.size !== stat.size ||
          current.mtimeMs !== stat.mtimeMs ||
          current.isSymbolicLink()
        ) {
          throw new Error("The environment file changed during setup.");
        }
        renameSync(temporary, file);
      } finally {
        closeSync(output);
        rmSync(temporary, { force: true });
      }
      return file;
    }
    if (/^\s*(?:export\s+)?JOLTS_(?:API_KEY|ENDPOINT)\s*=/m.test(existing)) {
      throw new Error("Jolts is already configured. Existing settings were preserved.");
    }
    fchmodSync(descriptor, 0o600);
    const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    writeFileSync(descriptor, `${separator}JOLTS_API_KEY=${token}\nJOLTS_ENDPOINT=${endpoint}\n`);
    return file;
  } finally {
    closeSync(descriptor);
  }
}

export function connectionDigest(directory: string): string {
  const root = projectRoot(directory);
  const file = join(root, ".env.local");
  const descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 65536) {
      throw new Error("The environment file must be a small regular file.");
    }
    const content = readFileSync(descriptor, "utf8");
    const entries = [...content.matchAll(/^JOLTS_API_KEY=([a-f0-9]{64})$/gm)];
    const token = entries[0]?.[1];
    if (
      !token ||
      entries.length !== 1 ||
      content.match(/^\s*(?:export\s+)?JOLTS_API_KEY\s*=/gm)?.length !== 1
    )
      throw new Error("No unique installed connection was found.");
    return createHash("sha256").update(token).digest("hex");
  } finally {
    closeSync(descriptor);
  }
}

function projectRoot(directory: string): string {
  const root = realpathSync(directory);
  const git = (...args: string[]) =>
    spawnSync("git", ["-C", root, ...args], { stdio: "ignore" }).status;
  if (git("ls-files", "--error-unmatch", "--", ".env.local") === 0) {
    throw new Error(".env.local is tracked. Remove it from Git before setup.");
  }
  if (git("check-ignore", "--quiet", "--", ".env.local") !== 0) {
    throw new Error(".env.local must be ignored by Git before setup.");
  }
  return root;
}
