import React from "react";
import { PageHeader } from "@/components/ui";

// Legacy API kept so every existing page picks up the new header:
// activePageText = visible title, pageTitle = current breadcrumb label.
const PageBanner = ({ pageTitle, homePageUrl = "/", homePageText = "Home", activePageText, description }) => (
	<PageHeader
		title={activePageText}
		description={description}
		crumbs={[
			{ href: homePageUrl, label: homePageText },
			{ label: pageTitle },
		]}
	/>
);

export default PageBanner;
