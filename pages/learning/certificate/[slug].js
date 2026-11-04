import React, { useRef, useEffect, useState } from "react";
import * as htmlToImage from "html-to-image";
import { jsPDF } from "jspdf";
import baseUrl from "@/utils/baseUrl";
import axios from "axios";
import toast from "react-hot-toast";
import { useRouter } from "next/router";
import Navbar from "@/components/_App/Navbar";
import Footer from "@/components/_App/Footer";
import { PageHeader } from "@/components/ui";

const CertificatePage = ({ user }) => {
	const [student, setStudent] = useState(
		user && `${user.first_name} ${user.last_name}`
	);
	const [course, setCourse] = useState({});
	const router = useRouter();
	const { slug } = router.query;

	useEffect(() => {
		const fetchCourse = async () => {
			try {
				const payload = {
					params: { slug: slug },
				};
				const url = `${baseUrl}/api/courses/course`;
				const response = await axios.get(url, payload);
				setCourse(response.data.course);
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

		if (user) {
			fetchCourse();
		} else {
			router.push(`/learning/my-courses`);
		}
	}, [slug]);

	const domEl = useRef(null);

	const downloadCertificate = async () => {
		const dataUrl = await htmlToImage.toJpeg(domEl.current);

		//download certificate
		const link = document.createElement("a");
		link.download = `${student.toLowerCase().replaceAll(" ", "-")}.jpg`;
		link.href = dataUrl;
		link.click();
	};

	const downloadCertificatePdf = async () => {
		const dataUrl = await htmlToImage.toJpeg(domEl.current);

		const pdf = new jsPDF();
		pdf.addImage(dataUrl, "JPEG", 0, 0);
		pdf.save(`${student.toLowerCase().replaceAll(" ", "-")}.pdf`);
	};

	return (
		<>
			<Navbar user={user} />

			<main>
				<PageHeader
					title="Your certificate"
					description="Congratulations on completing the course! Check your name, then download your certificate."
					crumbs={[
						{ href: "/learning/my-courses/", label: "My learning" },
						{ label: "Certificate" },
					]}
				/>
				<div className="ss-container ss-container--wide ss-student get-certificate">
					<div className="ss-cert">
						<div className="ss-card ss-cert__form">
							<form onSubmit={(e) => e.preventDefault()}>
								<label className="form-label" htmlFor="cert-name">
									Name on certificate
								</label>
								<input
									id="cert-name"
									type="text"
									className="form-control"
									placeholder="Enter your name"
									value={student}
									onChange={(e) => setStudent(e.target.value)}
								/>
							</form>
							<div className="ss-cert__actions">
								<button type="button" className="ss-btn ss-btn--block" onClick={downloadCertificatePdf}>
									<i className="ri-file-pdf-line" aria-hidden="true"></i> Download PDF
								</button>
								<button type="button" className="ss-btn ss-btn--secondary ss-btn--block" onClick={downloadCertificate}>
									<i className="ri-image-line" aria-hidden="true"></i> Download image (JPG)
								</button>
							</div>
						</div>

						<div className="ss-cert__preview">
							<div id="domEl" ref={domEl} className="certificate-img">
								<div className="content">
									<h2>{student}</h2>
									<p>
										For completing the <b>{course && course.title}</b>
									</p>
								</div>
								{/* eslint-disable-next-line @next/next/no-img-element */}
								<img src="/images/certificate.png" alt="" />
							</div>
						</div>
					</div>
				</div>
			</main>

			<Footer />
		</>
	);
};

export default CertificatePage;
