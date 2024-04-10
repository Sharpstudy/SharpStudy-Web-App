import React from "react";
import Navbar from "@/components/_App/Navbar";
import PageBanner from "../components/Common/PageBanner";
import {
	Accordion,
	AccordionItem,
	AccordionItemHeading,
	AccordionItemPanel,
	AccordionItemButton,
} from "react-accessible-accordion";
import Footer from "@/components/_App/Footer";
import Business from "@/components/Index/Business";

export default function FAQPage({ user }) {
	return (
		<>
			<Navbar user={user} />

			<PageBanner
				pageTitle="Frequently Asked Questions"
				homePageUrl="/"
				homePageText="Home"
				activePageText="FAQ's"
			/>

			<div className="faq-area ptb-100">
				<div className="container">
					<div className="faq-accordion">
						<Accordion allowZeroExpanded preExpanded={["a"]}>
							<AccordionItem uuid="a">
								<AccordionItemHeading>
									<AccordionItemButton>
									Can I access course materials on any device?
									</AccordionItemButton>
								</AccordionItemHeading>
								<AccordionItemPanel>
									<p>
									In addition to our workshops Yes, our platform is accessible on desktop computers, laptops, tablets, and smartphones. You can learn anytime, anywhere, as long as you have an internet connection.
									</p>
								</AccordionItemPanel>
							</AccordionItem>

							<AccordionItem uuid="b">
								<AccordionItemHeading>
									<AccordionItemButton>
									How does microlearning work on Sharpstudy?
									</AccordionItemButton>
								</AccordionItemHeading>
								<AccordionItemPanel>
									<p>
									Microlearning on our platform involves breaking down complex topics into smaller, digestible lessons. Each lesson is focused on specific learning objectives, allowing students to learn at their own pace and reinforce their understanding effectively.
									</p>
								</AccordionItemPanel>
							</AccordionItem>

							<AccordionItem uuid="c">
								<AccordionItemHeading>
									<AccordionItemButton>
									What is personalized learning?
									</AccordionItemButton>
								</AccordionItemHeading>
								<AccordionItemPanel>
									<p>
									Personalized learning on our platform means tailoring the educational experience to each student's individual needs, preferences, and learning style. We use data-driven insights to recommend courses and content that align with a student's unique learning profile.
									</p>
								</AccordionItemPanel>
							</AccordionItem>

							<AccordionItem uuid="d">
								<AccordionItemHeading>
									<AccordionItemButton>
									What types of courses do you offer?
									</AccordionItemButton>
								</AccordionItemHeading>
								<AccordionItemPanel>
									<p>
									We offer a wide range of advanced courses across various subjects, including mathematics, science, coding, languages, and more. Our courses are designed to challenge and engage students at different proficiency levels.
									</p>
								</AccordionItemPanel>
							</AccordionItem>

							<AccordionItem uuid="e">
								<AccordionItemHeading>
									<AccordionItemButton>
									How are courses structured?
									</AccordionItemButton>
								</AccordionItemHeading>
								<AccordionItemPanel>
									<p>
									Our courses are structured into modules or lessons, with each lesson focusing on specific learning objectives. Students can progress through the courses at their own pace, and our platform adapts to their learning progress.
									</p>
								</AccordionItemPanel>
							</AccordionItem>
						</Accordion>
					</div>
				</div>
			</div>

			<Business />

			<Footer />
		</>
	);
}


