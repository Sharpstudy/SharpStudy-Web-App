import React, { useState, useEffect } from "react";
import Navbar from "@/components/_App/Navbar";
import { PageHeader } from "@/components/ui";
import CourseSkeletonLoader from "@/utils/CourseSkeletonLoader";
import CoursesList from "@/components/Courses/CoursesList";
import Footer from "@/components/_App/Footer";
import SearchForm from "@/components/_App/SearchForm";
import FilterDropdown from "@/components/Courses/FilterDropdown";
import { useRouter } from "next/router";
import Pagination from "@etchteam/next-pagination";
import axios from "axios";
import baseUrl from "@/utils/baseUrl";

export default function CoursesPage({ user }) {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pages, setPages] = useState(0);
  const [coursesCount, setCoursesCount] = useState(0);
  const router = useRouter();
  const page = router.query.page ? router.query.page : "1";
  const size = router.query.size ? router.query.size : "8";
  const short = router.query.short ? router.query.short : "";
  const search = router.query.search ? router.query.search : "";

  const fetchCourses = async () => {
    setLoading(true);

    const payload = {
      params: {
        page,
        limit: size,
        short: short,
        search: search,
      },
    };
    const response = await axios.get(`${baseUrl}/api/all-courses`, payload);
    setCourses(response.data.courses);
    setPages(response.data.totalPages);
    setCoursesCount(response.data.coursesCount);
    setLoading(false);
  };
  useEffect(() => {
    fetchCourses();
  }, [page, size, short, search]);

  return (
    <>
      <Navbar user={user} />

      <main>
        <PageHeader
          title={search ? `Results for “${search}”` : "Explore courses"}
          description="Project-based courses and workshops to build cognitive, technical and business skills."
          crumbs={[{ href: "/", label: "Home" }, { label: "Courses" }]}
        />

        <section className="ss-section ss-section--tight">
          <div className="ss-container ss-container--wide">
            <div className="ss-toolbar">
              <p className="ss-toolbar__count" aria-live="polite">
                {loading ? "Loading courses…" : (
                  <>
                    <strong>{coursesCount}</strong> course{coursesCount === 1 ? "" : "s"} available
                  </>
                )}
              </p>
              <ul className="ss-toolbar__controls">
                <li className="ss-toolbar__search">
                  <SearchForm formClass="ss-search" btnClass="ss-search__btn" />
                </li>
                <FilterDropdown />
              </ul>
            </div>

            {loading ? (
              <CourseSkeletonLoader count={4} />
            ) : (
              courses && <CoursesList courses={courses} user={user} />
            )}
            {coursesCount > 9 && (
              <div className="pagination-area text-center mt-5">
                <Pagination sizes={[1]} total={pages} />
              </div>
            )}
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}
