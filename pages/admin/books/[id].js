import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import axios from "axios";
import toast from "react-hot-toast";
import AdminLayout from "@/components/_App/AdminLayout";
import GeneralLoader from "@/utils/GeneralLoader";
import { Button, Badge } from "@/components/ui";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import BookCover from "@/components/Books/BookCover";
import { CATEGORIES, SUBJECTS, AGE_GROUPS, GRADES, READING_LEVELS, MAX_AGE, matchingAgeGroups } from "@/lib/books/taxonomy";

const EMPTY = { title: "", author: "", slug: "", description: "", category: "general", subject: "", language: "en", price: "0", publisher: "", publishedYear: "", isbn: "", externalUrl: "", coverUrl: "", tags: "", ageGroup: "", minAge: "", maxAge: "", openEnded: false, gradeMin: "", gradeMax: "", readingLevel: "", featured: false };
const msg = (e, fallback) => (e.response && e.response.data && e.response.data.message) || fallback;
const toBase64 = (file) =>
	new Promise((resolve, reject) => {
		const r = new FileReader();
		r.onload = () => resolve(String(r.result).split(",")[1] || "");
		r.onerror = () => reject(new Error("Could not read the file"));
		r.readAsDataURL(file);
	});

const fromBook = (b) => ({
	title: b.title, author: b.author, slug: b.slug, description: b.description || "", category: b.category, subject: b.subject || "", language: b.language,
	price: (b.priceCents / 100).toFixed(2), publisher: b.publisher || "", publishedYear: b.publishedYear || "", isbn: b.isbn || "", externalUrl: b.externalUrl || "",
	coverUrl: "", tags: (b.tags || []).join(", "), ageGroup: b.ageGroup || "", minAge: b.minAge ?? "", maxAge: b.openEnded ? "" : b.maxAge ?? "", openEnded: !!b.openEnded,
	gradeMin: b.gradeMin ?? "", gradeMax: b.gradeMax ?? "", readingLevel: b.readingLevel || "", featured: !!b.featured,
});

// Everything typed here is validated again by the server (lib/books/validate.js); this form only helps.
const AdminBookForm = ({ user }) => {
	const router = useRouter();
	const id = router.query.id;
	const isNew = id === "new";
	const [form, setForm] = useState(EMPTY);
	const [book, setBook] = useState(null);
	const [loading, setLoading] = useState(!isNew);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");
	const [progress, setProgress] = useState({}); // kind -> 0..100
	const [confirm, setConfirm] = useState(null);
	const [coverBlob, setCoverBlob] = useState(null);

	useEffect(() => {
		if (!id || isNew) return;
		axios
			.get(`/api/admin/books/${id}`)
			.then((r) => {
				setBook(r.data.book);
				setForm(fromBook(r.data.book));
			})
			.catch((e) => setError(msg(e, "Could not load this book.")))
			.finally(() => setLoading(false));
	}, [id, isNew]);

	const set = (name) => (e) => setForm((f) => ({ ...f, [name]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
	const pickGroup = (e) => {
		const g = AGE_GROUPS.find((x) => x.id === e.target.value);
		setForm((f) => ({ ...f, ageGroup: e.target.value, ...(g ? { minAge: g.min, maxAge: g.max >= MAX_AGE ? "" : g.max, openEnded: g.max >= MAX_AGE } : {}) }));
	};

	// Age groups the typed range overlaps (a book may sit in several).
	const derived = useMemo(() => {
		const min = form.minAge === "" ? null : Number(form.minAge);
		const max = form.openEnded ? MAX_AGE : form.maxAge === "" ? null : Number(form.maxAge);
		return min == null || max == null || Number.isNaN(min) || Number.isNaN(max) || min > max ? null : matchingAgeGroups(min, max);
	}, [form.minAge, form.maxAge, form.openEnded]);

	const payload = () => {
		const p = { ...form };
		if (!p.coverUrl) delete p.coverUrl;
		if (isNew) delete p.slug; // generated from the title unless one is typed
		if (isNew && !form.slug) delete p.slug;
		return p;
	};

	const save = async (e) => {
		e.preventDefault();
		setSaving(true);
		setError("");
		try {
			if (isNew) {
				const r = await axios.post("/api/admin/books", payload());
				toast.success("Draft created. Now upload the cover and book file.");
				router.replace(`/admin/books/${r.data.book.id}/`);
			} else {
				const r = await axios.patch(`/api/admin/books/${id}`, payload());
				setBook(r.data.book);
				toast.success("Saved.");
			}
		} catch (err) {
			setError(msg(err, "Could not save."));
			window.scrollTo({ top: 0, behavior: "smooth" });
		} finally {
			setSaving(false);
		}
	};

	// "direct": the server hands out a short-lived signed URL and the file goes straight to private object
	// storage (large files cannot pass through a serverless function). "server": the file is sent as base64.
	// Either way the server inspects the stored bytes before attaching them to the book.
	const upload = (kind) => async (e) => {
		const file = e.target.files && e.target.files[0];
		e.target.value = "";
		if (!file) return;
		const bar = (n) => setProgress((p) => ({ ...p, [kind]: n }));
		bar(1);
		try {
			const plan = (await axios.post(`/api/admin/books/upload/${id}`, { kind, mode: "init", size: file.size, contentType: file.type })).data;
			let result;
			if (plan.mode === "direct") {
				// No Authorization header goes to the storage provider (the interceptor only adds it to /api/ URLs).
				await axios.put(plan.url, file, { headers: plan.headers, onUploadProgress: (ev) => bar(Math.max(1, Math.round((ev.loaded / (ev.total || file.size)) * 95))) });
				result = await axios.post(`/api/admin/books/upload/${id}`, { kind, mode: "complete", key: plan.key });
			} else {
				const data = await toBase64(file);
				result = await axios.post(`/api/admin/books/upload/${id}`, { kind, data }, { onUploadProgress: (ev) => bar(Math.max(1, Math.round((ev.loaded / (ev.total || 1)) * 95))) });
			}
			bar(100);
			setBook(result.data.book);
			toast.success("Uploaded and checked.");
		} catch (err) {
			toast.error(msg(err, "The upload failed."));
		} finally {
			setTimeout(() => bar(0), 800);
		}
	};

	// Cover preview: the cover route needs the admin login for unpublished books, which an <img> cannot send,
	// so fetch it with the token and show it from a temporary object URL.
	const coverApi = book && book.hasCover && book.coverUrl && book.coverUrl.startsWith("/api/") ? book.coverUrl : null;
	useEffect(() => {
		let url;
		let gone = false;
		setCoverBlob(null);
		if (coverApi) {
			axios
				.get(coverApi, { responseType: "blob", params: { v: book.updatedAt } })
				.then((r) => {
					if (gone) return;
					url = URL.createObjectURL(r.data);
					setCoverBlob(url);
				})
				.catch(() => {});
		}
		return () => {
			gone = true;
			if (url) URL.revokeObjectURL(url);
		};
	}, [coverApi, book && book.updatedAt]);

	// Open the private PDF in a new tab through the authenticated endpoint (administrators may read any book).
	const openFile = async () => {
		try {
			const r = await axios.get(`/api/books/${book.id}/content`, { responseType: "blob" });
			window.open(URL.createObjectURL(r.data), "_blank", "noopener");
		} catch (err) {
			toast.error(msg(err, "Could not open the file."));
		}
	};

	const askStatus = (status) => {
		if (status === "published") return setStatus(status);
		setConfirm({ status, title: status === "archived" ? `Archive “${book.title}”?` : `Unpublish “${book.title}”?`, body: status === "archived" ? "Archived books disappear from the store and cannot be bought. Existing buyers keep their access and order history stays." : "The book disappears from the store until you publish it again. Existing buyers keep their access." });
	};

	const setStatus = async (status) => {
		try {
			const r = await axios.patch(`/api/admin/books/${id}`, { status });
			setBook(r.data.book);
			toast.success(`Book ${status}.`);
		} catch (err) {
			toast.error(msg(err, "Could not change the status."));
		}
	};

	const text = (name, label, props = {}) => (
		<div className="ss-filter">
			<label htmlFor={`bk-${name}`}>{label}</label>
			<input id={`bk-${name}`} value={form[name]} onChange={set(name)} {...props} />
		</div>
	);
	const select = (name, label, options, anyLabel = "Not set", onChange) => (
		<div className="ss-filter">
			<label htmlFor={`bk-${name}`}>{label}</label>
			<select id={`bk-${name}`} value={form[name]} onChange={onChange || set(name)}>
				{anyLabel && <option value="">{anyLabel}</option>}
				{options.map((o) => (
					<option key={o.id} value={o.id}>
						{o.label}
					</option>
				))}
			</select>
		</div>
	);
	const fileField = (kind, inputId, label, accept, have) => (
		<div className="ss-filter">
			<label htmlFor={inputId}>
				{label} {have ? "— uploaded" : "— none"}
			</label>
			<input id={inputId} type="file" accept={accept} onChange={upload(kind)} disabled={!!progress[kind]} />
			{!!progress[kind] && (
				<div className="ss-uploadbar" role="progressbar" aria-valuenow={progress[kind]} aria-valuemin={0} aria-valuemax={100} aria-label={`Uploading ${kind}`}>
					<div style={{ width: `${progress[kind]}%` }} />
				</div>
			)}
		</div>
	);

	return (
		<AdminLayout user={user} title={isNew ? "Add new book" : book ? book.title : "Book"} description="Details, discovery settings, files and publishing.">
			{loading ? (
				<GeneralLoader />
			) : (
				<>
					{error && <p className="ss-notice ss-notice--error" role="alert">{error}</p>}
					{book && book.isDemo && (
						<p className="ss-notice" role="note">
							<Badge tone="accent">Demo</Badge> This is a fictional demo book created by the development seeder. You can edit, publish, unpublish, archive or reprice it like any other.
						</p>
					)}
					<form onSubmit={save} className="ss-adminform">
						<fieldset className="ss-card">
							<legend>Basic information</legend>
							{text("title", "Title", { required: true, maxLength: 200 })}
							{text("author", "Author", { required: true, maxLength: 160 })}
							{text("slug", "Web address (slug)", { maxLength: 80, placeholder: "generated from the title", disabled: false, pattern: "[a-z0-9]+(-[a-z0-9]+)*" })}
							{text("language", "Language code", { maxLength: 3, placeholder: "en" })}
							<div className="ss-filter ss-filter--wide">
								<label htmlFor="bk-description">Description</label>
								<textarea id="bk-description" rows={5} maxLength={5000} value={form.description} onChange={set("description")} />
							</div>
							{text("publisher", "Publisher", { maxLength: 160 })}
							{text("publishedYear", "Publication year", { inputMode: "numeric" })}
							{text("isbn", "ISBN (optional)")}
							<label className="ss-check">
								<input type="checkbox" checked={form.featured} onChange={set("featured")} /> Feature on the homepage
							</label>
						</fieldset>

						<fieldset className="ss-card">
							<legend>Price and availability</legend>
							{text("price", "Price in INR (₹)", { inputMode: "decimal", placeholder: "299.00" })}
							<p className="ss-derived">Enter 0 for a free book. Paid books cost ₹50 to ₹50,000. The price is stored in paise and checked again by the server; students are always charged the saved price.</p>
							<p className="ss-derived">Status: {book ? <strong>{book.status}</strong> : "a new book starts as a draft"}. Use the publishing buttons below once a cover and a file are uploaded.</p>
						</fieldset>

						<fieldset className="ss-card">
							<legend>Age and education</legend>
							<p className="ss-derived">A book can span several ages and grades: set the real range. Age groups are derived from it.</p>
							{select("ageGroup", "Primary age group", AGE_GROUPS.map((g) => ({ id: g.id, label: `${g.label} (${g.range})` })), "Not set", pickGroup)}
							{text("minAge", "Minimum age", { inputMode: "numeric" })}
							{text("maxAge", "Maximum age", { inputMode: "numeric", disabled: form.openEnded })}
							<label className="ss-check">
								<input type="checkbox" checked={form.openEnded} onChange={set("openEnded")} /> No upper age limit (18+)
							</label>
							<p className="ss-derived" aria-live="polite">
								{derived ? `Appears in: ${derived.map((g) => g.label).join(", ")}.` : "Set both ages to see which age groups this book appears in. Without ages it suits all ages."}
							</p>
							{select("gradeMin", "Lowest grade", GRADES, "Not set")}
							{select("gradeMax", "Highest grade", GRADES, "Not set")}
							{select("category", "Category", CATEGORIES, null)}
							{select("subject", "Subject", SUBJECTS)}
							{select("readingLevel", "Reading level", READING_LEVELS)}
							{text("tags", "Tags (comma separated)", { placeholder: "fractions, puzzles" })}
						</fieldset>

						<fieldset className="ss-card">
							<legend>Reading resource (optional)</legend>
							{text("externalUrl", "Authorized external reading link (https)", { placeholder: "https://" })}
							{text("coverUrl", "Cover image link (https; or upload below)", { placeholder: "https://" })}
						</fieldset>

						<div className="ss-adminform__actions">
							<Button type="submit" disabled={saving}>{saving ? "Saving…" : isNew ? "Save as draft" : "Save changes"}</Button>
							<Button href="/admin/books/" variant="ghost">Back to books</Button>
						</div>
					</form>

					{book && (
						<section className="ss-card ss-adminfiles" aria-labelledby="files-title">
							<h2 id="files-title">Files and publishing</h2>
							<p className="ss-muted">Book files are private: kept in protected storage and delivered only to people who bought the book. Use only material you are licensed to sell.</p>
							<div className="ss-previewrow">
								{book.hasCover ? <BookCover book={{ ...book, coverUrl: coverApi ? coverBlob : book.coverUrl }} size="sm" /> : <span className="ss-muted">No cover yet</span>}
								{book.hasFile && (
									<button type="button" className="ss-btn ss-btn--secondary ss-btn--sm" onClick={openFile}>
										<i className="ri-file-pdf-line" aria-hidden="true"></i> Open book file
									</button>
								)}
								{book.hasPreview && book.status === "published" && (
									<a className="ss-btn ss-btn--ghost ss-btn--sm" href={`/api/books/${book.id}/preview`} target="_blank" rel="noopener noreferrer">
										<i className="ri-eye-line" aria-hidden="true"></i> Open public preview
									</a>
								)}
							</div>
							{fileField("cover", "up-cover", "Cover image (PNG, JPEG or WebP, max 2 MB)", "image/png,image/jpeg,image/webp", book.hasCover)}
							{fileField("file", "up-file", "Book file (PDF, max 20 MB)", "application/pdf", book.hasFile)}
							{fileField("preview", "up-preview", "Limited preview (a short sample PDF, optional)", "application/pdf", book.hasPreview)}
							<p>
								Status: <strong>{book.status}</strong> · Purchases: <strong>{book.sold ?? "—"}</strong>
							</p>
							<div className="ss-adminform__actions">
								{book.status !== "published" && <Button onClick={() => setStatus("published")}>Publish</Button>}
								{book.status === "published" && <Button variant="secondary" onClick={() => askStatus("draft")}>Unpublish</Button>}
								{book.status !== "draft" && book.status !== "published" && <Button variant="secondary" onClick={() => askStatus("draft")}>Save as draft</Button>}
								{book.status !== "archived" && <Button variant="ghost" onClick={() => askStatus("archived")}>Archive</Button>}
								<Button variant="ghost" href={`/books/${book.slug}/`} external>Preview public page</Button>
								<Link href={`/admin/books/?tab=orders&bookId=${book.id}&title=${encodeURIComponent(book.title)}`}>
									<a className="ss-btn ss-btn--ghost">View orders</a>
								</Link>
							</div>
						</section>
					)}
				</>
			)}
			<ConfirmDialog open={!!confirm} title={confirm ? confirm.title : ""} confirmLabel={confirm && confirm.status === "archived" ? "Archive" : "Unpublish"} onConfirm={() => { const st = confirm.status; setConfirm(null); setStatus(st); }} onCancel={() => setConfirm(null)}>
				<p>{confirm ? confirm.body : ""}</p>
			</ConfirmDialog>
		</AdminLayout>
	);
};

export default AdminBookForm;
