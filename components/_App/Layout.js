import React, { useState, useEffect } from "react";
import Head from "next/head";
import Script from "next/script";
import { Toaster } from "react-hot-toast";
import GoTop from "@/components/_App/GoTop";
import dynamic from "next/dynamic";
import axios from "axios";
import { useRouter } from "next/router";
import { designMode } from "./designMode";
import baseUrl from "@/utils/baseUrl";
import { FreeDemoProvider } from "@/components/FreeDemo/FreeDemoProvider";

// Loaded only once the site modal is actually switched on (keeps framer-motion out of the shared bundle).
const SiteModal = dynamic(() => import("./SiteModal"), { ssr: false });

const Layout = ({ children }) => {
	const { pathname } = useRouter();
	const mode = designMode(pathname);
	const [modalOpen, setModalOpen] = useState();
	const [modalImage, setModalImage] = useState("");
	const [modalWanted, setModalWanted] = useState(false); // stays true after the first open so the exit animation can still play

	useEffect(() => {
		const fetchSetting = async () => {
			const resp = await axios.get(`${baseUrl}/settings.json`);
			setModalOpen(resp.data.siteModal);
			if (resp.data.siteModal) setModalWanted(true);
			setModalImage(resp.data.siteModalImage);
			if (resp.data.siteModal) {
				document.body.style.overflow = "hidden";
			}
		};
		fetchSetting();
	}, []);

	const close = () => {
		setModalOpen(false);
		document.body.style.overflow = "unset";
	};

	return (
		<>
			<Head>
				<title>SharpStudy - Project based learning | Workshops | Skills</title>
				<meta
					name="viewport"
					content="initial-scale=1.0, width=device-width"
				/>
				<link
					rel="icon"
					href="/images/favicon.ico"
				/>
			</Head>

			{/* Playful for readers and visitors, restrained for instructor and admin work (tokens in _tokens.scss). */}
			<div className={`ss-app ss-mode--${mode}`}>
				<FreeDemoProvider>{children}</FreeDemoProvider>
			</div>
			<Script
        strategy="lazyOnload"
        src="https://www.googletagmanager.com/gtag/js?id=G-QQHKTTTD86"
      />
		<Script
			id="google-analytics"
			strategy="lazyOnload"
			dangerouslySetInnerHTML={{
			__html: `
							window.dataLayer = window.dataLayer || [];
							function gtag(){dataLayer.push(arguments);}
							gtag('js', new Date());
							gtag('config', 'G-QQHKTTTD86', {
								page_path: window.location.pathname,
							});
						`,
			}}
		/>


			<Toaster />

			<GoTop />

			{modalWanted && <SiteModal open={modalOpen} image={modalImage} onClose={close} />}
		</>
	);
};

export default Layout;
