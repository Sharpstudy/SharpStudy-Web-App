import React, { useState, useEffect } from "react";
import { useSelector } from "react-redux";
import Link from "next/link";
import baseUrl from "@/utils/baseUrl";
import axios from "axios";
import { useRouter } from "next/router";
import { motion } from "framer-motion";

const CourseCard = ({ course, onFav, onUnFav, userId, onAddCart }) => {
	const cartItems = useSelector((state) => state.cart.cartItems);
	const router = useRouter();
	const {
		id,
		title,
		slug,
		short_desc,
		latest_price,
		before_price,
		lessons,
		image,
		user,
		enrollments = [],
	} = course;
	const [fav, setfavs] = useState(false);
	const [add, setAdd] = useState(false);
	const [buy, setBuy] = useState(false);

	useEffect(() => {
		setAdd(cartItems.some((cart) => cart.id === id));
		if (userId && course && id) {
			const payload = {
				params: { userId: userId, courseId: id },
			};
			const url = `${baseUrl}/api/courses/course/exist`;
			axios.get(url, payload).then((result) => {
				if (result && result.data.enroll === true)
					setBuy(result.data.enroll);
			});
		}
	}, [course, cartItems]);

	useEffect(() => {
		if (userId) {
			const payload = {
				params: {
					userId: userId,
					courseId: id,
				},
			};

			const url = `${baseUrl}/api/favourites/new`;
			axios.get(url, payload).then((result) => {
				setfavs(result.data);
			});
		} else {
			setfavs(false);
		}
	}, [fav]);

	const instructor = user ? `${user.first_name} ${user.last_name}` : "";
	const price = Number(latest_price);

	return (
		<article className="ss-course-card">
			<Link href={`/course/${slug}`}>
				<a className="ss-course-card__media" tabIndex={-1} aria-hidden="true">
					{/* eslint-disable-next-line @next/next/no-img-element */}
					<img src={image} alt="" loading="lazy" />
				</a>
			</Link>
			{buy && (
				<span className="ss-badge ss-badge--success ss-course-card__flag">
					<i className="ri-check-line" aria-hidden="true"></i> Enrolled
				</span>
			)}

			<div className="ss-course-card__body">
				<h3 className="ss-course-card__title">
					<Link href={`/course/${slug}`}>
						<a>{title}</a>
					</Link>
				</h3>
				{short_desc && <p className="ss-course-card__desc ss-clamp-2">{short_desc}</p>}

				<div className="ss-course-card__meta">
					{user && (
						<span className="ss-course-card__author">
							{/* eslint-disable-next-line @next/next/no-img-element */}
							<img
								className="ss-avatar ss-avatar--sm"
								src={user.profile_photo ? user.profile_photo : "/images/admin/admin-9.jpg"}
								alt=""
							/>
							<span className="ss-truncate">{instructor}</span>
						</span>
					)}
					{lessons > 0 && (
						<span className="ss-course-card__lessons">
							<i className="ri-play-list-2-line" aria-hidden="true"></i> {lessons} lessons
						</span>
					)}
				</div>

				<div className="ss-course-card__foot">
					<div className="ss-course-card__price">
						{price > 0 ? <>${latest_price}</> : "Free"}
						{before_price > 0 && <del>${before_price}</del>}
					</div>
					<div className="ss-course-card__actions">
						{buy ? (
							<button
								type="button"
								className="ss-btn ss-btn--sm"
								onClick={() => router.push(`/learning/course/${slug}`)}
							>
								Go to course
							</button>
						) : add ? (
							<button
								type="button"
								className="ss-btn ss-btn--soft ss-btn--sm"
								onClick={() => router.push("/checkout")}
							>
								View cart
							</button>
						) : (
							<button
								type="button"
								className="ss-btn ss-btn--sm"
								onClick={() => onAddCart(course)}
							>
								Add to cart
							</button>
						)}
						<motion.button
							type="button"
							whileTap={{ scale: 0.85 }}
							className={`ss-course-card__fav${fav ? " is-on" : ""}`}
							aria-pressed={!!fav}
							aria-label={fav ? `Remove ${title} from wishlist` : `Add ${title} to wishlist`}
							onClick={() => {
								fav ? onUnFav(id) : onFav(id);
								setfavs(!fav);
							}}
						>
							<i className={fav ? "ri-heart-3-fill" : "ri-heart-3-line"} aria-hidden="true"></i>
						</motion.button>
					</div>
				</div>
			</div>
		</article>
	);
};

export default CourseCard;
