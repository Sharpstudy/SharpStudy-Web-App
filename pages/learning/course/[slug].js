import React, { useEffect, useState } from "react";
import Navbar from "@/components/_App/Navbar";
import Footer from "@/components/_App/Footer";
import StickyBox from "react-sticky-box";
import Player from "@/components/Learning/Player";
import { useRouter } from "next/router";
import baseUrl from "@/utils/baseUrl";
import axios from "axios";
import VideoList from "@/components/Learning/VideoList";
import ProgressManager from "@/components/Learning/ProgressManager";
import CourseOverview from "@/components/Learning/CourseOverview";
import Link from "next/link";
import { EmptyState } from "@/components/ui";
import CourseAsset from "@/components/Learning/CourseAsset";
import CourseDiscussion from "@/components/Learning/CourseDiscussion";
import CourseRating from "@/components/Learning/CourseRating";
import CourseFeedback from "@/components/Learning/CourseFeedback";
import CourseQuiz from "@/components/Learning/CourseQuiz";

const Index = ({ user }) => {
  const [videos, setVideos] = useState([]);
  const [course, setCourse] = useState({});
  const [selectedVideo, setSelectedVideo] = useState("");
  const [active, setActive] = useState("");
  const [tab, setTab] = useState("overview");
  const {
    query: { slug },
  } = useRouter();

  const [loaded, setLoaded] = useState(false);

  const fetchVideos = async () => {
    const url = `${baseUrl}/api/learnings/videos/${slug}`;
    const response = await axios.get(url);
    setVideos(response.data.videos);
    if (response.data.videos.length > 0) {
      setSelectedVideo(response.data.videos[0].video);
      setActive(response.data.videos[0].id);
    }
    setCourse(response.data.course);
    setLoaded(true);
  };

  useEffect(() => {
    if (slug) fetchVideos();
  }, [slug]);

  const tabs = [
    { id: "overview", label: "Overview", icon: "ri-file-list-3-line" },
    { id: "asset", label: "Resources", icon: "ri-folder-download-line" },
    { id: "quiz", label: "Quiz", icon: "ri-questionnaire-line" },
    { id: "discussion", label: "Discussion", icon: "ri-chat-3-line" },
    { id: "rating", label: "Rate course", icon: "ri-star-line" },
    { id: "feedback", label: "Feedback", icon: "ri-feedback-line" },
  ];

  const selectVideo = async (videoId) => {
    // console.log(videoId);
    try {
      const payload = {
        params: { userId: user.id, courseId: course.id },
      };
      const url = `${baseUrl}/api/learnings/video/${videoId}`;
      const response = await axios.get(url, payload);
      const {
        data: { video },
      } = response;

      setSelectedVideo(video.video);
      setActive(video.id);

      // console.log(video);
    } catch (err) {
      console.log(err.response.data);
    }
  };

  return (
    <>
      <Navbar user={user} />

      <main className="ss-player">
        <div className="ss-container ss-container--wide">
          <nav aria-label="Breadcrumb">
            <ol className="ss-breadcrumb">
              <li>
                <Link href="/learning/my-courses/">
                  <a>My learning</a>
                </Link>
              </li>
              <li aria-current="page">{course && course.title}</li>
            </ol>
          </nav>
          <h1 className="ss-player__title">{course && course.title}</h1>

          <div className="ss-player__grid">
            <div className="ss-player__stage">
              {selectedVideo ? (
                <Player videoSrc={selectedVideo} />
              ) : (
                loaded && (
                  <EmptyState
                    icon="ri-video-line"
                    title="No lessons published yet"
                    description="Your instructor hasn't uploaded any videos for this course. Check back soon."
                  />
                )
              )}
            </div>

            <aside className="ss-player__side" aria-label="Course content">
              <StickyBox offsetTop={96} offsetBottom={20}>
                <div className="ss-card ss-lessons">
                  <ProgressManager
                    videos_count={videos.length}
                    userId={user.id}
                    courseId={course.id}
                    selectedVideo={selectedVideo}
                  />
                  <h2 className="ss-lessons__title">
                    Lessons <span>{videos.length}</span>
                  </h2>
                  <ol className="ss-lessons__list">
                    {videos.length > 0 &&
                      videos.map((video) => (
                        <VideoList
                          key={video.id}
                          {...video}
                          onPlay={() => selectVideo(video.id)}
                          activeClass={active}
                        />
                      ))}
                  </ol>
                </div>
              </StickyBox>
            </aside>

            <div className="ss-player__tabs">
              <div className="ss-tabs" role="tablist" aria-label="Course sections">
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    id={`ptab-${t.id}`}
                    aria-selected={tab === t.id}
                    aria-controls="ptab-panel"
                    onClick={() => setTab(t.id)}
                  >
                    <i className={t.icon} aria-hidden="true"></i>
                    {t.label}
                  </button>
                ))}
              </div>

              <div id="ptab-panel" role="tabpanel" aria-labelledby={`ptab-${tab}`} className="ss-player__panel">
                {course && tab == "asset" ? (
                  <CourseAsset {...course} />
                ) : tab == "discussion" ? (
                  <CourseDiscussion {...course} />
                ) : tab == "rating" ? (
                  <CourseRating {...course} />
                ) : tab == "feedback" ? (
                  <CourseFeedback {...course} />
                ) : tab === "quiz" ? (
                  <CourseQuiz />
                ) : (
                  <CourseOverview {...course} />
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </>
  );
};

export default Index;
