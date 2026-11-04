import React, { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";

// pdf.js is loaded from cdnjs at runtime (pinned version), so no new npm dependency is added.
const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174";
let loader;
function loadPdfJs() {
	if (typeof window === "undefined") return Promise.reject(new Error("browser only"));
	if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
	if (!loader) {
		loader = new Promise((resolve, reject) => {
			const s = document.createElement("script");
			s.src = `${PDFJS}/pdf.min.js`;
			s.async = true;
			s.onload = async () => {
				try {
					// A cross-origin worker cannot be started directly: wrap the script in a same-origin blob.
					const code = await (await fetch(`${PDFJS}/pdf.worker.min.js`)).text();
					window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
					resolve(window.pdfjsLib);
				} catch (e) {
					reject(e);
				}
			};
			s.onerror = () => reject(new Error("The reader could not be loaded"));
			document.head.appendChild(s);
		});
		loader.catch(() => (loader = null));
	}
	return loader;
}

const ZOOMS = [0.6, 0.8, 1, 1.25, 1.5, 2, 2.5];

// Reads a purchased PDF. The file is fetched from the authenticated /content endpoint (the server
// re-checks the purchase on every request) and kept in memory only. Position is saved per account.
const PdfReader = ({ book, initialPage = 1 }) => {
	const canvasRef = useRef(null);
	const wrapRef = useRef(null);
	const pdfRef = useRef(null);
	const renderTask = useRef(null);
	const saveTimer = useRef(null);
	const [state, setState] = useState("loading"); // loading | ready | error
	const [error, setError] = useState("");
	const [total, setTotal] = useState(0);
	const [page, setPage] = useState(initialPage);
	const [zoom, setZoom] = useState(1);
	const [fit, setFit] = useState(true);
	const [rendering, setRendering] = useState(false);

	useEffect(() => {
		let gone = false;
		(async () => {
			try {
				// The server checks the purchase and says where to fetch the file: its own stream, or a signed
				// storage URL that expires in about two minutes (fetched without our credentials).
				const access = (await axios.get(`/api/books/${book.id}/access`)).data;
				// The login token is only attached to our own /api/ URLs, never to the storage provider.
				const file = await axios.get(access.url, { responseType: "arraybuffer" });
				const lib = await loadPdfJs();
				const pdf = await lib.getDocument({ data: new Uint8Array(file.data), disableRange: true, disableStream: true }).promise;
				if (gone) return;
				pdfRef.current = pdf;
				setTotal(pdf.numPages);
				setPage((p) => Math.min(Math.max(1, p), pdf.numPages));
				setState("ready");
			} catch (e) {
				if (gone) return;
				const status = e && e.response && e.response.status;
				setError(status === 403 ? "You do not have access to this book." : status === 401 ? "Please sign in again to keep reading." : "This book could not be opened. Please try again.");
				setState("error");
			}
		})();
		return () => {
			gone = true;
			if (pdfRef.current) pdfRef.current.destroy();
		};
	}, [book.id]);

	const draw = useCallback(async () => {
		const pdf = pdfRef.current;
		const canvas = canvasRef.current;
		if (!pdf || !canvas) return;
		if (renderTask.current) renderTask.current.cancel();
		setRendering(true);
		try {
			const pg = await pdf.getPage(page);
			const base = pg.getViewport({ scale: 1 });
			// Fit to the available width, but never wider than a comfortable reading column (wide desktops otherwise zoom a page far past one screen).
			const width = Math.min(wrapRef.current ? wrapRef.current.clientWidth - 8 : base.width, 860);
			const scale = fit ? Math.max(0.3, width / base.width) : zoom;
			const vp = pg.getViewport({ scale });
			const dpr = window.devicePixelRatio || 1;
			canvas.width = Math.floor(vp.width * dpr);
			canvas.height = Math.floor(vp.height * dpr);
			canvas.style.width = `${Math.floor(vp.width)}px`;
			canvas.style.height = `${Math.floor(vp.height)}px`;
			const ctx = canvas.getContext("2d");
			renderTask.current = pg.render({ canvasContext: ctx, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null });
			await renderTask.current.promise;
		} catch (e) {
			if (!(e && e.name === "RenderingCancelledException")) setError("A page could not be displayed.");
		} finally {
			setRendering(false);
		}
	}, [page, zoom, fit]);

	useEffect(() => {
		if (state === "ready") draw();
	}, [state, draw]);

	useEffect(() => {
		if (state !== "ready" || !fit) return;
		const onResize = () => draw();
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, [state, fit, draw]);

	// Save the reading position shortly after the reader stops turning pages.
	useEffect(() => {
		if (state !== "ready" || !total) return;
		clearTimeout(saveTimer.current);
		saveTimer.current = setTimeout(() => {
			axios.put(`/api/books/${book.id}/progress`, { position: page, total }).catch(() => {});
		}, 1200);
		return () => clearTimeout(saveTimer.current);
	}, [page, total, state, book.id]);

	const go = (n) => setPage((p) => Math.min(Math.max(1, n === "next" ? p + 1 : n === "prev" ? p - 1 : n), total || 1));
	const step = (dir) => {
		setFit(false);
		setZoom((z) => {
			const i = ZOOMS.findIndex((x) => x >= z);
			const at = i === -1 ? ZOOMS.length - 1 : i;
			return ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, at + dir))];
		});
	};
	const onKey = (e) => {
		if (e.target && /input|select|textarea/i.test(e.target.tagName)) return;
		if (e.key === "ArrowRight" || e.key === "PageDown") go("next");
		else if (e.key === "ArrowLeft" || e.key === "PageUp") go("prev");
		else if (e.key === "+" || e.key === "=") step(1);
		else if (e.key === "-") step(-1);
	};

	if (state === "loading") return <div className="ss-reader ss-reader--state" role="status">Opening your book…</div>;
	if (state === "error")
		return (
			<div className="ss-reader ss-reader--state" role="alert">
				<p>{error}</p>
				<button type="button" className="ss-btn" onClick={() => window.location.reload()}>
					Try again
				</button>
			</div>
		);

	return (
		<div className="ss-reader" onKeyDown={onKey} tabIndex={-1}>
			<div className="ss-reader__bar" role="toolbar" aria-label="Reader controls">
				<button type="button" className="ss-btn ss-btn--secondary ss-btn--sm" onClick={() => go("prev")} disabled={page <= 1} aria-label="Previous page">
					<i className="ri-arrow-left-s-line" aria-hidden="true"></i>
				</button>
				<label className="ss-reader__page">
					<span className="visually-hidden">Page number</span>
					<input type="number" min={1} max={total} value={page} onChange={(e) => e.target.value && go(parseInt(e.target.value, 10) || 1)} aria-label={`Page, of ${total}`} />
					<span aria-hidden="true">/ {total}</span>
				</label>
				<button type="button" className="ss-btn ss-btn--secondary ss-btn--sm" onClick={() => go("next")} disabled={page >= total} aria-label="Next page">
					<i className="ri-arrow-right-s-line" aria-hidden="true"></i>
				</button>
				<div className="ss-reader__progress">
					<div className="ss-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((page / total) * 100)} aria-label={`Reading progress: page ${page} of ${total}`}>
						<div className="ss-progress__bar" style={{ width: `${Math.round((page / total) * 100)}%` }} />
					</div>
					<span aria-hidden="true">{Math.round((page / total) * 100)}%</span>
				</div>
				<button type="button" className="ss-btn ss-btn--secondary ss-btn--sm" onClick={() => step(-1)} aria-label="Zoom out">
					<i className="ri-zoom-out-line" aria-hidden="true"></i>
				</button>
				<button type="button" className={`ss-btn ss-btn--sm ${fit ? "" : "ss-btn--secondary"}`} onClick={() => setFit(true)} aria-pressed={fit}>
					Fit width
				</button>
				<button type="button" className="ss-btn ss-btn--secondary ss-btn--sm" onClick={() => step(1)} aria-label="Zoom in">
					<i className="ri-zoom-in-line" aria-hidden="true"></i>
				</button>
			</div>
			<div className="ss-reader__stage" ref={wrapRef} aria-busy={rendering ? true : undefined}>
				<canvas ref={canvasRef} role="img" aria-label={`${book.title}, page ${page} of ${total}`} />
			</div>
			<p className="ss-reader__hint">Use the arrow keys to turn pages and + / − to zoom. Your place is saved automatically.</p>
		</div>
	);
};

export default PdfReader;
