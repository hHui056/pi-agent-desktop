import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Decision #12: Git Bash is the only precondition we cannot control. pi's `bash`
 * tool resolves `%ProgramFiles%\Git\bin\bash.exe` (then the x86 tree, then PATH),
 * and its failure mode is a confusing tool error rather than a clear message.
 */
export function detectGitBash(): string | null {
  const candidates = [
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
    join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Git', 'bin', 'bash.exe')
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  // Fall back to PATH entries.
  const pathValue = process.env.PATH ?? ''
  for (const entry of pathValue.split(';')) {
    if (!entry.trim()) continue
    const candidate = join(entry.trim(), 'bash.exe')
    if (existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Decision #10: seed ripgrep/fd into pi's own managed bin directory so the first
 * `grep`/`find` never depends on a runtime download. Only fills gaps — an entry
 * that already exists (pi may have downloaded a newer one) is left alone.
 */
export function seedManagedTools(): { seeded: string[]; targetDir: string } {
  const targetDir = join(homedir(), '.pi', 'agent', 'bin')
  const sourceDir = app.isPackaged
    ? join(process.resourcesPath, 'tools')
    : join(app.getAppPath(), 'vendor', 'tools')

  const seeded: string[] = []
  for (const name of ['rg.exe', 'fd.exe']) {
    const target = join(targetDir, name)
    const source = join(sourceDir, name)
    if (existsSync(target) || !existsSync(source)) continue
    try {
      mkdirSync(targetDir, { recursive: true })
      copyFileSync(source, target)
      seeded.push(name)
    } catch (error) {
      console.error(`[tools] failed to seed ${name}:`, error)
    }
  }
  return { seeded, targetDir }
}
