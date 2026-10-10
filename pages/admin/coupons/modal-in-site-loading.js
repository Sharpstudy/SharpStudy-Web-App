import React, { useState, useEffect } from "react";
import Link from "next/link";
import AdminLayout from "@/components/_App/AdminLayout";
import toast from "react-hot-toast";
import axios from "axios";
import baseUrl from "@/utils/baseUrl";
import { useRouter } from "next/router";

const ModalInSiteLoading = ({ user }) => {
	const [site, setSite] = useState("");
	const [siteImage, setSiteImage] = useState("");
	const [modalImage, setModalImage] = useState({ image_url: "" });
	const router = useRouter();

	useEffect(() => {
		const fetchSetting = async () => {
			const resp = await axios.get(`${baseUrl}/settings.json`);
			setSite(resp.data.siteModal);
			setSiteImage(resp.data.siteModalImage);
		};

		fetchSetting();
	}, []);

	const handleChange = (e) => {
		const { files } = e.target;

		const image_url = files[0].size / 1024 / 1024;
		if (image_url > 2) {
			toast.error(
				"The photo size greater than 2 MB. Make sure less than 2 MB.",
				{
					style: {
						border: "1px solid #ff0033",
						padding: "16px",
						color: "#ff0033",
					},
					iconTheme: {
						primary: "#ff0033",
						secondary: "#FFFAEE",
					},
				}
			);
			e.target.value = null;
			return;
		}
		setModalImage({
			image_url: files[0],
		});
	};

	const handleImageUpload = async () => {
		const data = new FormData();
		data.append("file", modalImage.image_url);
		data.append("upload_preset", process.env.UPLOAD_PRESETS);
		data.append("cloud_name", process.env.CLOUD_NAME);
		let response;
		if (modalImage.image_url) {
			response = await axios.post(process.env.CLOUDINARY_URL, data);
		}
		const imageUrl = response.data.url;

		return imageUrl;
	};

	const handleSiteSettings = async (e) => {
		e.preventDefault();
		try {
			let photo;
			if (modalImage.image_url) {
				photo = await handleImageUpload();

				photo = photo.replace(/^http:\/\//i, "https://");
			}

			const url = `${baseUrl}/api/site-settings`;
			const payload = { site: !site, image_url: photo };
			const response = await axios.post(url, payload);
			// console.log(response.data);
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
			router.push("/admin/coupons");
		} catch (err) {
			// console.log(err);
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

	return (
		<>

			<AdminLayout user={user} title="Coupons" description="Site pop-up shown when the site loads.">
								{/* Nav */}
								<ul className="nav-style1">
									<li>
										<Link href="/admin/coupons/">
											<a>Coupons</a>
										</Link>
									</li>
									<li>
										<Link href="/admin/coupons/create/">
											<a>Create</a>
										</Link>
									</li>
									<li>
										<Link href="/admin/coupons/modal-in-site-loading/">
											<a className="active">Site Modal</a>
										</Link>
									</li>
								</ul>
								{site ? "Disable" : "Enable"} modal after site
								loading
								<button
									className="default-btn ms-4"
									onClick={handleSiteSettings}
									style={{
										paddingLeft: "30px",
										paddingRight: "30px",
									}}
								>
									{site ? "Disable" : "Enable"} <span></span>
								</button>
								<form onSubmit={handleSiteSettings}>
									<label className="form-label fw-semibold">
										Image
									</label>
									<input
										type="file"
										className="form-control file-control"
										id="clientImage"
										name="image_url"
										onChange={handleChange}
										required={true}
									/>
									<div className="form-text">
										Upload image size 700x500!
									</div>
									<button
										className="default-btn mt-3"
										style={{
											paddingLeft: "30px",
											paddingRight: "30px",
										}}
									>
										Upload <span></span>
									</button>
								</form>
								<img
									className="mt-4"
									src={siteImage && siteImage}
								/>
			</AdminLayout>
		</>
	);
};

export default ModalInSiteLoading;
