/** Whether this person has already seen NOVA's opening ("Hey, I'm NOVA…"). Per signed-in user (never one
 * global flag), so a shared device shows it to each new person once; blocked storage just shows it again. */
const PREFIX = "nova.guide.intro.v1:";

export function loadIntroSeen(userKey: string): boolean {
  try {
    return window.localStorage.getItem(PREFIX + userKey) === "seen";
  } catch {
    return false;
  }
}

export function saveIntroSeen(userKey: string): void {
  try {
    window.localStorage.setItem(PREFIX + userKey, "seen");
  } catch {
    // best effort
  }
}
