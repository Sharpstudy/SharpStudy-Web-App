import React from "react";
import Link from "next/link";
import { CATEGORIES, SUBJECTS, AGE_GROUPS, GRADES, READING_LEVELS } from "@/lib/books/taxonomy";

const SORT_LABELS = { relevance: "Best match", newest: "Newest", popular: "Most popular", price_asc: "Price: low to high", price_desc: "Price: high to low", title: "Title A-Z" };

// A plain GET form: filters live in the URL (shareable, back-button friendly, works without JavaScript),
// and every value is validated again on the server.
const CatalogFilters = ({ filters, languages = [] }) => {
	const sel = (name, label, options, value) => (
		<div className="ss-filter">
			<label htmlFor={`f-${name}`}>{label}</label>
			<select id={`f-${name}`} name={name} defaultValue={value ?? ""}>
				<option value="">Any</option>
				{options.map((o) => (
					<option key={o.id} value={o.id}>
						{o.label}
					</option>
				))}
			</select>
		</div>
	);
	return (
		<form key={JSON.stringify(filters)} action="/books/" method="get" className="ss-card ss-filters" role="search" aria-label="Search and filter books">
			{filters.age != null && <input type="hidden" name="age" value={filters.age} />}
			<div className="ss-filter ss-filter--wide">
				<label htmlFor="f-q">Search title, author, subject or category</label>
				<input id="f-q" name="q" type="search" maxLength={80} defaultValue={filters.q || ""} placeholder="e.g. fractions, Python, Ada" />
			</div>
			{sel("ageGroup", "Age group", AGE_GROUPS.map((g) => ({ id: g.id, label: `${g.label} (${g.range.replace("Ages ", "")})` })), filters.ageGroup)}
			{sel("grade", "Grade level", GRADES, filters.grade)}
			{sel("category", "Category", CATEGORIES, filters.category)}
			{sel("subject", "Subject", SUBJECTS, filters.subject)}
			{sel("level", "Reading level", READING_LEVELS, filters.level)}
			{languages.length > 1 && sel("language", "Language", languages.map((l) => ({ id: l.code, label: l.name })), filters.language)}
			{sel("price", "Price", [{ id: "free", label: "Free" }, { id: "paid", label: "Paid" }], filters.price)}
			<div className="ss-filter">
				<label htmlFor="f-sort">Sort by</label>
				<select id="f-sort" name="sort" defaultValue={filters.sort}>
					{Object.entries(SORT_LABELS).map(([id, label]) => (
						<option key={id} value={id}>
							{label}
						</option>
					))}
				</select>
			</div>
			<div className="ss-filters__actions">
				<button type="submit" className="ss-btn">
					<i className="ri-filter-3-line" aria-hidden="true"></i> Apply
				</button>
				<Link href="/books/">
					<a className="ss-btn ss-btn--ghost">Clear</a>
				</Link>
			</div>
		</form>
	);
};

export default CatalogFilters;
