/** @param {string | undefined} value */
export function isJsonMediaType(value) {
  return value?.split(';', 1)[0].trim().toLowerCase() === 'application/json'
}
