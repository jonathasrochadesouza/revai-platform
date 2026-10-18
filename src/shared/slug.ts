// File-safe slug — same rules as the skill's revai.mjs slugify (branch/folder names).
export function slugify(s: string): string {
  const slug = s
    .replace(/[\\/:*?"<>|`'&#~^@+=%\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+/, '')
    .replace(/[-. ]+$/, '')
  return slug || 'review'
}
