// The optional site-wide promo modal. Loaded on demand (components/_App/Layout.js) so framer-motion is not part of the shared bundle
// every page downloads; the modal is switched off in public/settings.json today.
import React from "react";
import { AnimatePresence } from "framer-motion";
import Modal from "../Modal";

const SiteModal = ({ open, image, onClose }) => (
	<AnimatePresence initial={false} onExitComplete={() => null} mode="wait">
		{open && image && <Modal modalOpen={open} handleClose={onClose} image_url={image} />}
	</AnimatePresence>
);

export default SiteModal;
