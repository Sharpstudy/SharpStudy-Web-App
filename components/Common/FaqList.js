import React from "react";
import {
	Accordion,
	AccordionItem,
	AccordionItemHeading,
	AccordionItemPanel,
	AccordionItemButton,
} from "react-accessible-accordion";
import faqData from "./faqData";

const FaqList = ({ limit, preExpanded = ["a"], headingLevel = 3 }) => (
	<Accordion allowZeroExpanded preExpanded={preExpanded} className="ss-faq">
		{faqData.slice(0, limit || faqData.length).map((item) => (
			<AccordionItem uuid={item.id} key={item.id}>
				<AccordionItemHeading aria-level={headingLevel}>
					<AccordionItemButton>{item.q}</AccordionItemButton>
				</AccordionItemHeading>
				<AccordionItemPanel>
					<p>{item.a}</p>
				</AccordionItemPanel>
			</AccordionItem>
		))}
	</Accordion>
);

export default FaqList;
