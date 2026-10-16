import React, { useState } from "react";
import { useRouter } from "next/router";

const SearchForm = ({ formClass, btnClass = null, banner = false }) => {
	const [search, setSearch] = useState("");
	const router = useRouter();

	const handleSearch = (e) => {
		e.preventDefault();
		const query = router.query;
		router.push({
			pathname: "/courses",
			query: { ...query, search: search },
		});
	};
	return (
		<form className={formClass} onSubmit={handleSearch} role="search">
			<input
				type="search"
				className="form-control"
				placeholder="Search courses"
				aria-label="Search courses"
				name="search"
				value={search}
				onChange={(e) => setSearch(e.target.value)}
			/>
			<button type="submit" className={btnClass} aria-label="Search">
				{banner === true && <span>Search Now</span>}
				<i className="ri-search-line" aria-hidden="true"></i>
			</button>
		</form>
	);
};

export default SearchForm;
