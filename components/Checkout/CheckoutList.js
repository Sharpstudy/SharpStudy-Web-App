import React from "react";
import Link from "next/link";
import { motion, useIsPresent } from "framer-motion";

const CheckoutList = ({
	id,
	image,
	title,
	instructor,
	slug,
	price,
	regular_price,
	lessons,
	duration,
	access_time,
	onRemove,
}) => {
	const isPresent = useIsPresent();
	const anitmations = {
		style: {
			position: isPresent ? "static" : "absolute",
		},
		initial: { scale: 0, opacity: 0 },
		animate: { scale: 1, opacity: 1 },
		exit: { scale: 0, opacity: 0 },
	};
	return (
		<motion.li className="ss-card ss-cart__item" layout {...anitmations}>
			<Link href={`/course/${slug}`}>
				<a className="ss-cart__img" tabIndex={-1} aria-hidden="true">
					{/* eslint-disable-next-line @next/next/no-img-element */}
					<img src={image} alt="" />
				</a>
			</Link>
			<div className="ss-cart__body">
				<h3>
					<Link href={`/course/${slug}`}>
						<a>{title}</a>
					</Link>
				</h3>
				<p className="ss-muted">By {instructor}</p>
				<ul className="ss-purchase__facts">
					{lessons > 0 && (
						<li>
							<i className="ri-play-list-2-line" aria-hidden="true"></i>
							{lessons} lectures
						</li>
					)}
					{duration && (
						<li>
							<i className="ri-time-line" aria-hidden="true"></i>
							{duration}
						</li>
					)}
				</ul>
			</div>
			<div className="ss-cart__side">
				<div className="ss-cart__price">
					<strong>${price}</strong>
					{regular_price > 0 && <del>${regular_price}</del>}
				</div>
				<button type="button" onClick={() => onRemove(id)} className="ss-btn ss-btn--ghost ss-btn--sm" aria-label={`Remove ${title} from cart`}>
					<i className="ri-delete-bin-line" aria-hidden="true"></i> Remove
				</button>
			</div>
		</motion.li>
	);
};

export default CheckoutList;
