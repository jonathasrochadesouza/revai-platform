// Native folder-picking dialog (the browser cannot hand out absolute paths).
// Windows: FolderBrowserDialog via PowerShell (TopMost, invisible owner window).
// macOS: osascript choose folder · Linux: zenity.
import fs from 'node:fs'
import { stream } from './proc'

export async function pickFolder(startIn?: string): Promise<string | null> {
  const timeout = { timeoutMs: 300_000 }

  if (process.platform === 'win32') {
    const start =
      startIn && fs.existsSync(startIn)
        ? startIn.replace(/'/g, "''")
        : "[Environment]::GetFolderPath('UserProfile')"
    // Visible owner (small, topmost) — without it the FolderBrowserDialog never paints
    // (a form never shown = an invisible modal that blocks forever).
    const script = [
      "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
      "Add-Type -AssemblyName System.Windows.Forms",
      "Add-Type -AssemblyName System.Drawing",
      "$form = New-Object System.Windows.Forms.Form",
      "$form.Text = 'revai'",
      "$form.MaximizeBox = $false",
      "$form.MinimizeBox = $false",
      "$form.StartPosition = 'CenterScreen'",
      "$form.Size = New-Object System.Drawing.Size(240, 80)",
      "$form.TopMost = $true",
      "$form.Show()",
      "$form.Activate()",
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
      "$dialog.Description = 'Choose the project folder (git repository)'",
      "$dialog.ShowNewFolderButton = $false",
      `$dialog.SelectedPath = '${start}'`,
      "$res = $dialog.ShowDialog($form)",
      "$form.Close()",
      "if ($res -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }",
    ].join('\n')
    const r = await stream(['powershell.exe', '-NoProfile', '-STA', '-Command', script], timeout)
    if (r.code !== 0 && r.stderr.trim()) {
      // real script error — surfaces as a failure instead of a silent "cancelled"
      throw new Error(r.stderr.trim().split('\n').slice(-2).join('\n'))
    }
    const lines = r.stdout.trim().split(/\r?\n/).filter(Boolean)
    const last = lines[lines.length - 1]
    return last && last.length > 2 && fs.existsSync(last) ? last : null
  }

  if (process.platform === 'darwin') {
    const r = await stream(['osascript', '-e', 'POSIX path of (choose folder with prompt "Choose the project folder")'], timeout)
    const p = r.stdout.trim()
    return p && fs.existsSync(p) ? p : null
  }

  const r = await stream(['zenity', '--file-selection', '--directory', '--title=Choose the project folder'], timeout)
  const p = r.stdout.trim()
  return p && fs.existsSync(p) ? p : null
}
