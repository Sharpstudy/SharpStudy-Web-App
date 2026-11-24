import React from "react";
import Link from "next/link";
import ProgramArt from "./ProgramArt";
import { PROGRAMS, programHref } from "@/lib/programs/catalog";

// The four programs as cards (homepage, programs overview and the "other programs" strip on each program page).
const ProgramCards = ({ exclude, titleTag: Tag = "h3" }) => (
	<ul className="ss-progs">
		{PROGRAMS.filter((p) => p.slug !== exclude).map((p) => (
			<li key={p.slug}>
				<Link href={programHref(p.slug)}>
					<a className={`ss-prog ss-prog--${p.tone}`}>
						<ProgramArt slug={p.slug} tone={p.tone} className="ss-prog__art" />
						<Tag className="ss-prog__title">{p.title}</Tag>
						<p>{p.short}</p>
						<span className="ss-prog__go">
							Explore program <i className="ri-arrow-right-line" aria-hidden="true"></i>
						</span>
					</a>
				</Link>
			</li>
		))}
	</ul>
);

export default ProgramCards;
