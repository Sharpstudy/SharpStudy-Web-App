import React, { useEffect, useState } from "react";
import LoadingSpinner from "@/utils/LoadingSpinner";
import axios from "axios";
import baseUrl from "@/utils/baseUrl";
import toast from "react-hot-toast";
import { useRouter } from "next/router";
import { useDispatch } from "react-redux";
import StripeCheckout from "react-stripe-checkout";
import { calculateCartTotal } from "@/utils/calculateCartTotal";
import Button from "@/utils/Button";

const PlaceOrderBtn = ({ user, cartItems }) => {
	const [stripeAmount, setStripeAmount] = React.useState(0);
	const [loading, setLoading] = useState(false);
	const dispatch = useDispatch();
	const router = useRouter();

	useEffect(() => {
		const { stripeTotal } = calculateCartTotal(cartItems);
		setStripeAmount(stripeTotal);
	}, [cartItems]);

	const handleCheckout = async (stripeResult) => {
		setLoading(true);
		try {
			// Only the courses, coupon codes and Stripe's payment token are sent;
			// the server decides the buyer, the prices and whether payment succeeded.
			const payload = {
				cartItems: cartItems.map(({ id, price, coupon }) => ({ id, price, coupon })),
				stripeToken: stripeResult && stripeResult.id,
			};
			const url = `${baseUrl}/api/checkout`;
			const response = await axios.post(url, payload);
			if (response.status === 202) {
				toast(response.data.message);
				setLoading(false);
				return;
			}
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
			dispatch({
				type: "RESET_CART",
			});
			setLoading(false);
			router.push("/learning/my-courses");
		} catch (err) {
			// console.log(err.response);
			setLoading(false);
			const message =
				(err.response && err.response.data && err.response.data.message) ||
				"We could not reach the server. You have not been charged.";
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

	return (
		<StripeCheckout
			name="SharpStudy"
			amount={stripeAmount}
			currency="USD"
			stripeKey={process.env.STRIPE_PUBLISHABLE_KEY}
			token={handleCheckout}
			triggerEvent="onClick"
		>
			<Button
				loading={loading}
				disabled={cartItems.length == 0 || loading}
				btnText="Place order"
				btnClass="ss-btn ss-btn--lg ss-btn--block"
			/>
		</StripeCheckout>
	);
};

export default PlaceOrderBtn;
