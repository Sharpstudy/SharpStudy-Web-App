import React, { useEffect } from "react";
import { useSelector, useDispatch } from "react-redux";
import {
	calculateCartTotal,
	calculateCartTotalMinus,
} from "@/utils/calculateCartTotal";
import CheckoutList from "./CheckoutList";
import PlaceOrderBtn from "./PlaceOrderBtn";
import { AnimatePresence } from "framer-motion";
import { Button, EmptyState } from "@/components/ui";

const CheckoutForm = ({ user }) => {
	const cartItems = useSelector((state) => state.cart.cartItems);
	const dispatch = useDispatch();
	const [cartAmout, setCartAmaount] = React.useState(0);
	const [cartAmoutMinus, setCartAmaountMinus] = React.useState(0);

	useEffect(() => {
		const { cartTotal } = calculateCartTotal(cartItems);
		const { cartTotalMinus } = calculateCartTotalMinus(cartItems);
		setCartAmaount(cartTotal);
		setCartAmaountMinus(cartTotalMinus);
	}, [cartItems]);

	const handleRemove = async (cartId) => {
		// console.log(cartId);
		dispatch({
			type: "REMOVE_CART",
			id: cartId,
		});
	};

	if (cartItems.length === 0) {
		return (
			<div className="ss-container ss-student">
				<EmptyState
					icon="ri-shopping-cart-2-line"
					title="Your cart is empty"
					description="Courses you add to your cart will show up here."
					action={<Button href="/courses/">Continue shopping</Button>}
				/>
			</div>
		);
	}

	return (
		<div className="ss-container ss-container--wide ss-student">
			<div className="ss-checkout">
				<section aria-labelledby="cart-title">
					<h2 id="cart-title" className="ss-checkout__title">
						{cartItems.length} course{cartItems.length === 1 ? "" : "s"} in your cart
					</h2>
					<ul className="ss-cart">
						<AnimatePresence>
							{cartItems.map((cart) => (
								<CheckoutList
									key={cart.id}
									{...cart}
									onRemove={() => handleRemove(cart.id)}
								/>
							))}
						</AnimatePresence>
					</ul>
				</section>

				<aside className="ss-card ss-summary" aria-label="Order summary">
					<h2>Order summary</h2>
					{cartAmoutMinus > 0 && (
						<div className="ss-summary__row">
							<span>Original price</span>
							<del>${cartAmoutMinus}</del>
						</div>
					)}
					<div className="ss-summary__row ss-summary__total">
						<span>Total</span>
						<strong>${cartAmout}</strong>
					</div>
					<PlaceOrderBtn user={user} cartItems={cartItems} />
					<p className="ss-summary__note">
						<i className="ri-lock-line" aria-hidden="true"></i> Secure payment via Stripe
					</p>
				</aside>
			</div>
		</div>
	);
};

export default CheckoutForm;
