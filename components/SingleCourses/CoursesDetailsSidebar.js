import React, { useEffect, useState } from "react";
import { useSelector, useDispatch } from "react-redux";
import baseUrl from "@/utils/baseUrl";
import axios from "axios";
import toast from "react-hot-toast";
import { useRouter } from "next/router";
import BuyCourseBtn from "./BuyCourseBtn";
import { calculateDiscount, plural } from "@/utils/helper";

const CoursesDetailsSidebar = ({ current_user, course }) => {
	// console.log(course);
	const cartItems = useSelector((state) => state.cart.cartItems);
	const dispatch = useDispatch();
	const [add, setAdd] = useState(false);
	const [alreadyBuy, setAlreadyBuy] = useState(false);
	const router = useRouter();
	const [apply, setApplyCoupon] = useState(false);
	const [coupon, setCoupon] = useState({ coupon: "" });
	const discount = useSelector((state) => state.cart.discount);
	const couponCode = useSelector((state) => state.cart.couponCode);
	const couponPercent = useSelector((state) => state.cart.couponPercent);

	useEffect(() => {
		const courseExist = cartItems.find((cart) => {
			return course.id === cart.id;
		});
		courseExist && setAdd(true);
		if (current_user && course && course.id) {
			const payload = {
				params: { userId: current_user.id, courseId: course.id },
			};
			const url = `${baseUrl}/api/courses/course/exist`;
			axios.get(url, payload).then((result) => {
				if (result && result.data.enroll === true)
					setAlreadyBuy(result.data.enroll);
			});
		}
	}, [cartItems, course]);

	const addToCart = (courseCart) => {
		let courseObj = {};
		courseObj["id"] = courseCart.id;
		courseObj["title"] = courseCart.title;
		courseObj["slug"] = courseCart.slug;
		// Price shown in the cart; the server recomputes it from the database and the coupon code.
		courseObj["price"] = couponPercent > 0 ? calculateDiscount(couponPercent, courseCart.latest_price) : courseCart.latest_price;
		if (couponPercent > 0 && couponCode) courseObj["coupon"] = couponCode;
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

	const handleCoupon = async (e) => {
		e.preventDefault();
		try {
			const payload = { coupon: coupon };

			const response = await axios.post(
				`${baseUrl}/api/coupons/get-coupon`,
				payload
			);

			// console.log(response.data.discount);

			dispatch({
				type: "GET_COUPON",
				data: { code: String(typeof coupon === "string" ? coupon : coupon.coupon || "").trim(), percent: response.data.discount.discount },
			});
			dispatch({
				type: "GET_DISCOUNT",
				data: calculateDiscount(
					response.data.discount.discount,
					course.latest_price
				),
			});

			toast.success(response.data.message, {
				style: {
					border: "1px solid #4BB543",
					padding: "16px",
					color: "#4BB543",
				},
				iconTheme: {
					primary: "#4BB543",
					secondary: "#FFFAEE",
				},
			});
		} catch (err) {
			let {
				response: {
					data: { message },
				},
			} = err;
			toast.error(message, {
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
		}
	};

	const price = discount > 0 ? discount : course.latest_price;
	const facts = [
		{ icon: "ri-live-line", label: "Format", value: course.is_class ? "Live class" : "Self-paced" },
		{ icon: "ri-folder-2-line", label: "Category", value: course.category && course.category.name },
		{ icon: "ri-time-line", label: "Duration", value: course.duration },
		{ icon: "ri-booklet-line", label: "Lectures", value: course.lessons },
		{ icon: "ri-download-2-line", label: "Resources", value: `${course.assets ? course.assets.length : 0} downloadable` },
		{ icon: "ri-group-line", label: "Enrolled", value: plural(course.enrolments ? course.enrolments.length : 0, "student") },
		{ icon: "ri-key-2-line", label: "Access", value: course.access_time },
	];

	return (
		<aside className="ss-course-body__side" aria-label="Purchase">
			<div className="ss-card ss-card--flush ss-buy">
				<div className="ss-buy__media">
					{/* eslint-disable-next-line @next/next/no-img-element */}
					<img src={course.image} alt="" />
				</div>
				<div className="ss-buy__body">
					<div className="ss-buy__price">
						<strong>${price}</strong>
						{course.before_price > 0 && <del>${course.before_price}</del>}
						{course.before_price > 0 && <span className="ss-badge ss-badge--success">Offer for today</span>}
					</div>

					<div className="ss-buy__actions">
						{alreadyBuy ? (
							<button type="button" onClick={() => router.push("/learning/my-courses")} className="ss-btn ss-btn--lg ss-btn--block">
								View my courses
							</button>
						) : add ? (
							<button type="button" onClick={() => router.push("/checkout")} className="ss-btn ss-btn--lg ss-btn--block">
								View cart
							</button>
						) : (
							<button type="button" onClick={() => addToCart(course)} className="ss-btn ss-btn--lg ss-btn--block">
								<i className="ri-shopping-cart-2-line" aria-hidden="true"></i> Add to cart
							</button>
						)}
						{!alreadyBuy && !add && <BuyCourseBtn current_user={current_user} course={course} />}
					</div>

					<div className="ss-buy__coupon">
						<button
							type="button"
							className="ss-linkbtn"
							aria-expanded={apply}
							aria-controls="coupon-form"
							onClick={() => setApplyCoupon(!apply)}
						>
							<i className="ri-coupon-3-line" aria-hidden="true"></i> Have a coupon?
						</button>
						{apply && (
							<form id="coupon-form" onSubmit={handleCoupon} className="ss-inline-form">
								<label htmlFor="coupon-input" className="visually-hidden">
									Coupon code
								</label>
								<input
									id="coupon-input"
									type="text"
									className="form-control"
									placeholder="Enter coupon"
									name="search"
									value={coupon.coupon}
									onChange={(e) => setCoupon(e.target.value)}
								/>
								<button type="submit" className="ss-btn ss-btn--secondary">
									Apply
								</button>
							</form>
						)}
					</div>

					<h2 className="ss-buy__title">This course includes</h2>
					<dl className="ss-facts">
						{facts.map((item) =>
							item.value !== undefined && item.value !== null && item.value !== "" ? (
								<div key={item.label}>
									<dt>
										<i className={item.icon} aria-hidden="true"></i>
										{item.label}
									</dt>
									<dd>{item.value}</dd>
								</div>
							) : null
						)}
					</dl>
				</div>
			</div>
		</aside>
	);
};

export default CoursesDetailsSidebar;
