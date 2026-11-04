// Only one floating menu may be open at a time: opening a menu closes whichever one was open before.
let current = null;

export function claimMenu(close) {
	if (current && current !== close) current();
	current = close;
}

export function releaseMenu(close) {
	if (current === close) current = null;
}

export const openMenuCount = () => (current ? 1 : 0);
