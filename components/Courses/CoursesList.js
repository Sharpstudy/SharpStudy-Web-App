import React from "react";
import { useDispatch } from "react-redux";
import axios from "axios";
import toast from "react-hot-toast";
import baseUrl from "@/utils/baseUrl";
import CourseCard from "./CourseCard";
import { Button, EmptyState } from "@/components/ui";

const CoursesList = ({ courses, user, empty }) => {
	const dispatch = useDispatch();

	const addToCart = (courseCart) => {
		let courseObj = {};
		courseObj["id"] = courseCart.id;
		courseObj["title"] = courseCart.title;
		courseObj["slug"] = courseCart.slug;
		courseObj["price"] = courseCart.latest_price;
		courseObj["regular_price"] = courseCart.before_price;
		courseObj["image"] = courseCart.image;
		courseObj["lessons"] = courseCart.lessons;
		courseObj["duration"] = courseCart.duration;
		courseObj["access_time"] = courseCart.access_time;
		courseObj["quantity"] = 1;
		courseObj[
			"instructor"
		] = `${courseCart.user.first_name} ${courseCart.user.last_name}`;
		dispatch({
			type: "ADD_TO_CART",
			data: courseObj,
		});
	};

	const handleFav = async (courseId, fav) => {
		if (!user) {
			toast.error("Need to login first.", {
				style: {
					border: "1px solid #ff0033",
					padding: "16px",
					color: "#ff0033",
				},
				iconTheme: {
					primary: "#ff0033",
					secondary: "#FFFAEE",
				},
			});
			return;
		}
		try {
			const payload = {
				userId: user.id,
				courseId: courseId,
				fav: fav,
			};
			const url = `${baseUrl}/api/favourites/new`;
			const response = await axios.post(url, payload);

			toast.success(response.data.message, {
				style: {
					border: "1px solid #42ba96",
					padding: "16px",
					color: "#42ba96",
				},
				iconTheme: {
					primary: "#42ba96",
					secondary: "#ffffff",
				},
			});
		} catch (err) {
			console.log(err.response);
		}
	};

	if (!courses || courses.length === 0) {
		return (
			empty || (
				<EmptyState
					icon="ri-book-open-line"
					title="No courses to show yet"
					description="Try a different search or browse the full catalogue."
					action={<Button href="/courses/" variant="secondary">Browse all courses</Button>}
				/>
			)
		);
	}

	return (
		<div className="ss-grid ss-grid--cards">
			{courses.map((course) => (
				<CourseCard
					key={course.id}
					course={course}
					onFav={() => handleFav(course.id, true)}
					onUnFav={() => handleFav(course.id, false)}
					userId={user && user.id}
					onAddCart={() => addToCart(course)}
				/>
			))}
		</div>
	);
};

export default CoursesList;
