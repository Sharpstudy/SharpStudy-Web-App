// Homepage hero background video: the landing page video already stored at public/images/team/ (original file, untouched).
// The file name contains a space, so the URL is percent-encoded. Details: H.264 MP4, 3840x2160, 15.5 s, no audio track, about 26.6 MB.
//
// `poster` is a still frame taken from that same video (public/images/sharpstudy-hero-poster.jpg). It is what visitors see when the video is
// not played (phones, reduced motion, data saver) and while the video is loading. Set HERO_VIDEO to null to go back to the illustrated hero.
export const HERO_VIDEO = {
	mp4: "/images/team/landingpage%20video.mp4",
	poster: "/images/sharpstudy-hero-poster.jpg",
};

// A hero video is only attempted for visitors who can comfortably play it.
export const HERO_VIDEO_MIN_WIDTH = 768; // phones get the poster/indigo hero instead of downloading the video
