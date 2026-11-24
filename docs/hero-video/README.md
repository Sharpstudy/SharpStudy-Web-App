# Homepage hero video

**Status: the video has NOT been produced.** The tool that built this integration cannot generate video, so no footage exists in the repository, and nothing was substituted for it (no stock footage, illustration or slideshow). The homepage currently shows the indigo illustrated hero. Everything else needed is in place, so adding the video is a file drop plus one config edit.

## 1. Produce the footage (outside this repository)

Use a video-generation or production service of your choice (or commission real footage). The brief:

* 15 seconds, 16:9, at least 1920×1080, photorealistic, premium corporate-documentary look, natural indigo and warm golden grade, no text, logos, subtitles or watermarks, no audio needed.
* 0–3 s Indian school students entering a modern classroom. 3–6 s a mentor guiding a small group through a collaborative activity. 6–9 s students solving maths puzzles with notebooks and a whiteboard. 9–12 s a confident student presenting to classmates. 12–15 s school and college-age learners collaborating and celebrating.
* Make the first and last frames similar so the loop is not jarring.

Two things worth deciding before publishing:

* **Disclosure.** If the footage is AI-generated, the people in it are not real SharpStudy students. Presenting it as real footage of your learners could mislead visitors and, in some places, conflicts with advertising rules. Consider a short note in the footer or the video's page, or use real, consented footage of your own classes.
* **Real footage of children** needs written parent/guardian consent, as for the gallery (see `docs/website-sections/README.md`).

## 2. Encode for the web

The hero needs to stay light (aim for under 3 MB for the MP4). With ffmpeg installed:

```
ffmpeg -i source.mp4 -an -vf "scale=1280:-2,fps=24" -c:v libx264 -crf 28 -preset slow -movflags +faststart public/videos/sharpstudy-hero-720p.mp4
ffmpeg -i source.mp4 -an -vf "scale=1280:-2,fps=24" -c:v libvpx-vp9 -crf 38 -b:v 0 public/videos/sharpstudy-hero-720p.webm
ffmpeg -i source.mp4 -vf "select=eq(n\,30),scale=1280:-2" -frames:v 1 -q:v 3 public/images/sharpstudy-hero-poster.jpg
```

`-an` removes the audio track (the video is muted anyway). The poster should be a frame that also reads well under the dark indigo overlay.

## 3. Switch it on

Edit `lib/site/heroMedia.js` and replace `HERO_VIDEO = null` with:

```js
export const HERO_VIDEO = {
	mp4: "/videos/sharpstudy-hero-720p.mp4",
	webm: "/videos/sharpstudy-hero-720p.webm", // optional
	poster: "/images/sharpstudy-hero-poster.jpg",
};
```

With a video configured, the hero becomes a full-width video background with a dark indigo overlay, the headline, text and both buttons unchanged on top, and the illustration removed. It plays muted, looping and inline, with a pause button. It is not loaded on screens narrower than 768px, with "reduce motion" on, or with data saver on (those visitors see the poster). If the file fails to load the poster stays.

## Homepage statistics

The four figures (50K+, 98%, 3000+, 4.9★) live in `lib/site/stats.js`. They were supplied as proposed content, are not computed from the database and have not been verified; the page says "Figures provided by SharpStudy." Publish figures like these only if you can substantiate them, and update or remove them there if they change.
