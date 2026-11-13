import React, { useState } from "react";

const hue = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);

// The cover image, or a generated cover (title on a colour) when there is none or it fails to load.
const BookCover = ({ book, size = "md" }) => {
	const [broken, setBroken] = useState(false);
	const h = hue(book.slug || book.title);
	if (book.coverUrl && !broken) {
		return (
			<div className={`ss-bookcover ss-bookcover--${size}`}>
				{/* eslint-disable-next-line @next/next/no-img-element */}
				<img src={book.coverUrl} alt={`Cover of ${book.title}`} loading="lazy" onError={() => setBroken(true)} />
			</div>
		);
	}
	return (
		<div className={`ss-bookcover ss-bookcover--${size} ss-bookcover--generated`} style={{ background: `linear-gradient(145deg, hsl(${h} 55% 38%), hsl(${(h + 40) % 360} 60% 28%))` }} role="img" aria-label={`Cover of ${book.title}`}>
			<span>{book.title}</span>
		</div>
	);
};

export default BookCover;
