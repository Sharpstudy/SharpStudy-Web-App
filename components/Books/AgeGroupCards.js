import React from "react";
import Link from "next/link";
import { AGE_GROUPS } from "@/lib/books/taxonomy";
import { booksHref } from "./format";

// "Explore Books by Age": one illustrated card per age group. Choosing a group is just a link with a
// query value - nothing about the child or the account is read or stored.
const AgeGroupCards = ({ active, extra = {}, heading = true }) => (
	<nav aria-label="Explore books by age" className="ss-agegrid-wrap">
		{heading && <h2 className="visually-hidden">Explore books by age</h2>}
		<ul className="ss-agegrid">
			{AGE_GROUPS.map((g, i) => {
				const on = active === g.id;
				return (
					<li key={g.id}>
						<Link href={booksHref({ ...extra, ageGroup: on ? undefined : g.id })}>
							<a className={`ss-agecard tone-${i}${on ? " is-active" : ""}`} aria-current={on ? "true" : undefined} aria-label={`${g.label}, ${g.range}${on ? " (selected)" : ""}`}>
								<span className="ss-agecard__art" aria-hidden="true">
									<i className={g.icon}></i>
								</span>
								<span className="ss-agecard__range">{g.range}</span>
								<span className="ss-agecard__label">{g.label}</span>
							</a>
						</Link>
					</li>
				);
			})}
		</ul>
	</nav>
);

export default AgeGroupCards;
