import React, { useState } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import { useRouter } from "next/router";
import StripeCheckout from "react-stripe-checkout";
import Button from "@/utils/Button";
import { readerPath } from "./BuyBox";

const fail = (message) =>
	toast.error(message, { style: { border: "1px solid #ff0033", padding: "16px", color: "#ff0033" }, iconTheme: { primary: "#ff0033", secondary: "#FFFAEE" } });

// Sends only WHICH book and Stripe's payment token (plus the price the buyer saw, which the server
// compares with its own). The server decides the buyer, the price and whether the payment succeeded.
const PayButton = ({ book }) => {
	const router = useRouter();
	const [loading, setLoading] = useState(false);

	const submit = async (token) => {
		setLoading(true);
		try {
			const res = await axios.post("/api/books/checkout", { bookId: book.id, stripeToken: token ? token.id : undefined, priceCents: book.priceCents });
			if (res.status === 202) {
				toast(res.data.message);
				router.push("/learning/my-books/");
				return;
			}
			toast.success(res.data.message);
			router.push("/learning/my-books/");
		} catch (err) {
			const data = (err.response && err.response.data) || {};
			if (data.error_code === "already_owned") {
				toast("You already own this book.");
				router.push(readerPath(book.slug));
				return;
			}
			fail(data.message || "We could not reach the server. You have not been charged.");
			setLoading(false);
		}
	};

	if (book.free) {
		return (
			<button type="button" className="ss-btn ss-btn--lg ss-btn--block" disabled={loading} aria-busy={loading ? true : undefined} onClick={() => submit(null)}>
				Add to My Books
			</button>
		);
	}
	return (
		<StripeCheckout name="SharpStudy Books" description={book.title} amount={book.priceCents} currency="USD" stripeKey={process.env.STRIPE_PUBLISHABLE_KEY} token={submit} triggerEvent="onClick">
			<Button loading={loading} disabled={loading} type="button" btnText="Pay now" btnClass="ss-btn ss-btn--lg ss-btn--block" />
		</StripeCheckout>
	);
};

export default PayButton;
