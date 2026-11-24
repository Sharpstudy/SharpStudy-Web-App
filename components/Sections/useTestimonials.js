import { useEffect, useState } from "react";
import axios from "axios";
import baseUrl from "@/utils/baseUrl";

// The admin-managed testimonials (existing GET /api/testimonials). Returns null while loading, then the list ([] when none or on error).
const useTestimonials = () => {
	const [items, setItems] = useState(null);
	useEffect(() => {
		let alive = true;
		axios
			.get(`${baseUrl}/api/testimonials`)
			.then((r) => alive && setItems((r.data && r.data.testimonials) || []))
			.catch(() => alive && setItems([]));
		return () => {
			alive = false;
		};
	}, []);
	return items;
};

export default useTestimonials;
