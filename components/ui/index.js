// SharpStudy UI primitives. Thin wrappers around the `ss-*` classes in
// styles/sharpstudy so pages share one visual language.
import React from "react";
import Link from "next/link";

const cx = (...c) => c.filter(Boolean).join(" ");

const btnClass = (variant, size, block, className) =>
	cx(
		"ss-btn",
		variant && variant !== "primary" && `ss-btn--${variant}`,
		size && `ss-btn--${size}`,
		block && "ss-btn--block",
		className
	);

// Renders a Next <Link> when `href` is given, otherwise a <button>.
export const Button = ({
	href,
	variant = "primary",
	size,
	block,
	icon,
	iconRight,
	className,
	children,
	external,
	type = "button",
	...rest
}) => {
	const cls = btnClass(variant, size, block, className);
	const content = (
		<>
			{icon && <i className={icon} aria-hidden="true"></i>}
			{children}
			{iconRight && <i className={iconRight} aria-hidden="true"></i>}
		</>
	);
	if (href && external) {
		return (
			<a href={href} className={cls} target="_blank" rel="noopener noreferrer" {...rest}>
				{content}
			</a>
		);
	}
	if (href) {
		return (
			<Link href={href}>
				<a className={cls} {...rest}>
					{content}
				</a>
			</Link>
		);
	}
	return (
		<button type={type} className={cls} {...rest}>
			{content}
		</button>
	);
};

export const Badge = ({ tone, className, children }) => (
	<span className={cx("ss-badge", tone && `ss-badge--${tone}`, className)}>{children}</span>
);

export const SectionHeader = ({ eyebrow, title, description, align, action, as: Tag = "h2" }) => {
	const text = (
		<>
			{eyebrow && <span className="ss-eyebrow">{eyebrow}</span>}
			<Tag>{title}</Tag>
			{description && <p>{description}</p>}
		</>
	);
	if (action) {
		return (
			<div className="ss-section-head ss-section-head--split">
				<div>{text}</div>
				{action}
			</div>
		);
	}
	return (
		<div className={cx("ss-section-head", align === "center" && "ss-section-head--center")}>
			{text}
		</div>
	);
};

// Inner-page header with breadcrumb. `crumbs` = [{ href, label }, ...]; the
// last crumb is rendered as the current page.
export const PageHeader = ({ title, description, crumbs, actions, wide = true }) => (
	<header className="ss-page-header">
		<div className={cx("ss-container", wide && "ss-container--wide")}>
			{crumbs && crumbs.length > 0 && (
				<nav aria-label="Breadcrumb">
					<ol className="ss-breadcrumb">
						{crumbs.map((c, i) =>
							i === crumbs.length - 1 ? (
								<li key={i} aria-current="page">
									{c.label}
								</li>
							) : (
								<li key={i}>
									<Link href={c.href}>
										<a>{c.label}</a>
									</Link>
								</li>
							)
						)}
					</ol>
				</nav>
			)}
			<div className="ss-page-header__row">
				<div style={{ minWidth: 0 }}>
					<h1>{title}</h1>
					{description && <p>{description}</p>}
				</div>
				{actions && <div className="d-flex flex-wrap gap-2">{actions}</div>}
			</div>
		</div>
	</header>
);

export const EmptyState = ({ icon = "ri-inbox-line", title, description, action }) => (
	<div className="ss-empty">
		<span className="ss-icon-tile ss-icon-tile--lg" aria-hidden="true">
			<i className={icon}></i>
		</span>
		<h3>{title}</h3>
		{description && <p>{description}</p>}
		{action}
	</div>
);

export const StatTile = ({ icon, tone, value, label }) => (
	<div className="ss-card ss-stat">
		{icon && (
			<span className={cx("ss-icon-tile", tone && `ss-icon-tile--${tone}`)} aria-hidden="true">
				<i className={icon}></i>
			</span>
		)}
		<div style={{ minWidth: 0 }}>
			<div className="ss-stat__value">{value}</div>
			<p className="ss-stat__label">{label}</p>
		</div>
	</div>
);

export const ProgressBar = ({ value = 0, label, tone }) => {
	const v = Math.max(0, Math.min(100, Number(value) || 0));
	return (
		<div
			className={cx("ss-progress", tone && `ss-progress--${tone}`)}
			role="progressbar"
			aria-valuenow={v}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-label={label || "Progress"}
		>
			<div className="ss-progress__bar" style={{ width: `${v}%` }} />
		</div>
	);
};

export const Avatar = ({ src, alt = "", size }) => (
	// eslint-disable-next-line @next/next/no-img-element
	<img
		className={cx("ss-avatar", size && `ss-avatar--${size}`)}
		src={src || "/images/admin/admin-9.jpg"}
		alt={alt}
	/>
);
