import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { handleLogout } from "@/utils/auth";
import { accountLinks } from "./accountLinks";

// Click / keyboard operated account menu (was hover-only, unusable on touch).
const ProfileDropdown = ({ first_name, last_name, email, role, profile_photo }) => {
	const [open, setOpen] = useState(false);
	const ref = useRef(null);
	const router = useRouter();

	useEffect(() => {
		if (!open) return;
		const onDown = (e) => {
			if (ref.current && !ref.current.contains(e.target)) setOpen(false);
		};
		const onKey = (e) => e.key === "Escape" && setOpen(false);
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	useEffect(() => {
		const close = () => setOpen(false);
		router.events.on("routeChangeStart", close);
		return () => router.events.off("routeChangeStart", close);
	}, [router.events]);

	const photo = profile_photo || "/images/admin/admin-9.jpg";
	const fullName = [first_name, last_name].filter(Boolean).join(" ");

	return (
		<div className="ss-menu" ref={ref}>
			<button
				type="button"
				className="ss-menu__trigger"
				aria-haspopup="menu"
				aria-expanded={open}
				aria-label="Open account menu"
				onClick={() => setOpen((o) => !o)}
			>
				{/* eslint-disable-next-line @next/next/no-img-element */}
				<img className="ss-avatar" src={photo} alt="" />
				<i className="ri-arrow-down-s-line d-none d-xl-inline" aria-hidden="true"></i>
			</button>

			{open && (
				<div className="ss-menu__panel" role="menu">
					<div className="ss-menu__head">
						{/* eslint-disable-next-line @next/next/no-img-element */}
						<img className="ss-avatar" src={photo} alt="" />
						<div style={{ minWidth: 0 }}>
							<div className="ss-menu__name ss-truncate">{fullName || first_name}</div>
							<div className="ss-menu__email ss-truncate">{email}</div>
						</div>
					</div>
					{accountLinks(role).map((l) => (
						<Link href={l.href} key={l.href}>
							<a className="ss-menu__item" role="menuitem">
								<i className={l.icon} aria-hidden="true"></i>
								{l.label}
							</a>
						</Link>
					))}
					<div className="ss-menu__sep" role="separator"></div>
					<button type="button" className="ss-menu__item" role="menuitem" onClick={handleLogout}>
						<i className="ri-logout-box-r-line" aria-hidden="true"></i>
						Log out
					</button>
				</div>
			)}
		</div>
	);
};

export default ProfileDropdown;
