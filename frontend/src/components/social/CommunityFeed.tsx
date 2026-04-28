"use client";

import React, { useState, memo } from "react";
import Image from "next/image";
import {
  Heart,
  MessageCircle,
  Share2,
  MoreVertical,
  Flag,
  Bookmark,
  Trash2,
  Pin,
  Send,
  Hash,
  ImageIcon,
  Video,
  TrendingUp,
  Award,
  Users,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { AvatarWithStatus } from "./OnlineStatus";
import { CommunityPost } from "@/types/social";
import { Virtuoso } from "react-virtuoso";

interface CommunityFeedProps {
  posts: CommunityPost[];
  currentUser: {
    id: string;
    username: string;
    avatar: string;
  };
  onLikePost: (postId: string) => void;
  onAddComment: (postId: string, content: string) => void;
  onCreatePost: (content: string, tags: string[]) => void;
  onSharePost?: (postId: string) => void;
  onReportPost?: (postId: string) => void;
}

// Memoized Post Component
const Post = memo(({ 
  post, 
  currentUser, 
  onLikePost, 
  onSharePost, 
  onReportPost, 
  showComments, 
  setShowComments, 
  commentInput, 
  setCommentInput, 
  handleAddComment, 
  activeMenu, 
  setActiveMenu,
  formatTime 
}: { 
  post: CommunityPost; 
  currentUser: any;
  onLikePost: (postId: string) => void;
  onSharePost?: (postId: string) => void;
  onReportPost?: (postId: string) => void;
  showComments: string | null;
  setShowComments: (id: string | null) => void;
  commentInput: string;
  setCommentInput: (val: string) => void;
  handleAddComment: (postId: string) => void;
  activeMenu: string | null;
  setActiveMenu: (id: string | null) => void;
  formatTime: (ts: string) => string;
}) => {
  const isLiked = post.isLiked;
  const isPinned = post.isPinned;
  const showCommentsForThis = showComments === post.id;

  return (
    <Card className={`${isPinned ? "border-primary/30" : ""}`}>
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <AvatarWithStatus
              avatar={post.author.avatar}
              username={post.author.username}
              status={post.author.status}
              size="md"
            />
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">{post.author.username}</span>
                {isPinned && (
                  <span className="flex items-center gap-1 text-xs text-primary">
                    <Pin className="h-3 w-3" />
                    Pinned
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{formatTime(post.createdAt)}</span>
                <span>·</span>
                <span>ELO {post.author.elo}</span>
              </div>
            </div>
          </div>
          <div className="relative">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setActiveMenu(activeMenu === post.id ? null : post.id)}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
            {activeMenu === post.id && (
              <div className="absolute right-0 top-full mt-1 bg-card border rounded-md shadow-lg z-10 min-w-[150px]">
                <button
                  className="w-full px-3 py-2 text-sm text-left hover:bg-muted flex items-center gap-2"
                  onClick={() => setActiveMenu(null)}
                >
                  <Bookmark className="h-4 w-4" />
                  Save Post
                </button>
                <button
                  className="w-full px-3 py-2 text-sm text-left hover:bg-muted flex items-center gap-2"
                  onClick={() => {
                    onSharePost?.(post.id);
                    setActiveMenu(null);
                  }}
                >
                  <Share2 className="h-4 w-4" />
                  Share
                </button>
                <button
                  className="w-full px-3 py-2 text-sm text-left hover:bg-muted flex items-center gap-2 text-red-600"
                  onClick={() => {
                    onReportPost?.(post.id);
                    setActiveMenu(null);
                  }}
                >
                  <Flag className="h-4 w-4" />
                  Report
                </button>
                {post.author.id === currentUser.id && (
                  <>
                    <div className="border-t my-1" />
                    <button
                      className="w-full px-3 py-2 text-sm text-left hover:bg-muted flex items-center gap-2 text-red-600"
                      onClick={() => setActiveMenu(null)}
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Content */}
        <p className="text-sm mb-3 whitespace-pre-wrap">{post.content}</p>

        {/* Tags */}
        {post.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {post.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full"
              >
                <Hash className="h-3 w-3" />
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Media */}
        {post.media && post.media.length > 0 && (
          <div className="mb-3 rounded-lg overflow-hidden space-y-2">
            {post.media.map((media, index) => (
              <div key={index} className="relative w-full aspect-video">
                <Image
                  src={media.url}
                  alt={post.content.slice(0, 50) || "Post media"}
                  fill
                  className="object-cover"
                  sizes="(max-width: 768px) 100vw, 66vw"
                  loading="lazy"
                />
              </div>
            ))}
          </div>
        )}

        {/* Stats */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground mb-3">
          <span>{post.likes} likes</span>
          <span>{post.comments} comments</span>
          <span>{post.shares} shares</span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 border-t pt-3">
          <Button
            variant="ghost"
            size="sm"
            className={`flex-1 ${isLiked ? "text-red-500" : ""}`}
            onClick={() => onLikePost(post.id)}
          >
            <Heart className={`h-4 w-4 mr-2 ${isLiked ? "fill-current" : ""}`} />
            Like
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="flex-1"
            onClick={() => setShowComments(showCommentsForThis ? null : post.id)}
          >
            <MessageCircle className="h-4 w-4 mr-2" />
            Comment
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="flex-1"
            onClick={() => onSharePost?.(post.id)}
          >
            <Share2 className="h-4 w-4 mr-2" />
            Share
          </Button>
        </div>

        {/* Comments Section */}
        {showCommentsForThis && (
          <div className="mt-4 pt-4 border-t space-y-3">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Write a comment..."
                value={commentInput}
                onChange={(e) => setCommentInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleAddComment(post.id);
                  }
                }}
                className="flex-1 px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <Button
                variant="primary"
                size="sm"
                onClick={() => handleAddComment(post.id)}
                disabled={!commentInput.trim()}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
});

Post.displayName = "Post";

export function CommunityFeed({
  posts,
  currentUser,
  onLikePost,
  onAddComment,
  onCreatePost,
  onSharePost,
  onReportPost,
}: CommunityFeedProps) {
  const [newPostContent, setNewPostContent] = useState("");
  const [newPostTags, setNewPostTags] = useState("");
  const [showComments, setShowComments] = useState<string | null>(null);
  const [commentInput, setCommentInput] = useState("");
  const [activeMenu, setActiveMenu] = useState<string | null>(null);

  const handleCreatePost = () => {
    if (newPostContent.trim()) {
      const tags = newPostTags
        .split(",")
        .map(t => t.trim().toLowerCase())
        .filter(t => t.length > 0);
      onCreatePost(newPostContent.trim(), tags);
      setNewPostContent("");
      setNewPostTags("");
    }
  };

  const handleAddComment = (postId: string) => {
    if (commentInput.trim()) {
      onAddComment(postId, commentInput.trim());
      setCommentInput("");
    }
  };

  const formatTime = (timestamp: string) => {
    const now = new Date();
    const then = new Date(timestamp);
    const diffMs = now.getTime() - then.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    return then.toLocaleDateString();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Main Feed */}
      <div className="lg:col-span-2">
        {/* Create Post */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex gap-3">
              <AvatarWithStatus
                avatar={currentUser.avatar}
                username={currentUser.username}
                status="online"
                size="md"
              />
              <div className="flex-1 space-y-3">
                <textarea
                  placeholder="Share something with the community..."
                  value={newPostContent}
                  onChange={(e) => setNewPostContent(e.target.value)}
                  className="w-full p-3 bg-muted rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={3}
                />
                <div className="flex items-center justify-between">
                  <input
                    type="text"
                    placeholder="Tags (comma separated, e.g., guide, tips)"
                    value={newPostTags}
                    onChange={(e) => setNewPostTags(e.target.value)}
                    className="flex-1 mr-3 px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleCreatePost}
                    disabled={!newPostContent.trim()}
                  >
                    <Send className="h-4 w-4 mr-2" />
                    Post
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" className="h-8">
                    <ImageIcon className="h-4 w-4 mr-1" />
                    Image
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8">
                    <Video className="h-4 w-4 mr-1" />
                    Video
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {posts.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
                <MessageCircle className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-2">No posts yet</h3>
              <p className="text-sm text-muted-foreground">
                Be the first to share something with the community!
              </p>
            </CardContent>
          </Card>
        ) : (
          <Virtuoso
            useWindowScroll
            data={posts}
            itemContent={(index, post) => (
              <div className="pb-4">
                <Post 
                  key={post.id} 
                  post={post} 
                  currentUser={currentUser}
                  onLikePost={onLikePost}
                  onSharePost={onSharePost}
                  onReportPost={onReportPost}
                  showComments={showComments}
                  setShowComments={setShowComments}
                  commentInput={commentInput}
                  setCommentInput={setCommentInput}
                  handleAddComment={handleAddComment}
                  activeMenu={activeMenu}
                  setActiveMenu={setActiveMenu}
                  formatTime={formatTime}
                />
              </div>
            )}
          />
        )}
      </div>

      {/* Sidebar */}
      <div className="hidden lg:block">
        <div className="sticky top-6">
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <h3 className="font-semibold flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Trending Tags
                </h3>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {[
                    { tag: "tournament", count: 156 },
                    { tag: "strategy", count: 89 },
                    { tag: "ranked", count: 67 },
                    { tag: "tips", count: 45 },
                    { tag: "recruitment", count: 32 },
                  ].map((item) => (
                    <div
                      key={item.tag}
                      className="flex items-center justify-between py-2 hover:bg-muted/40 rounded-lg px-2 -mx-2 cursor-pointer transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <Hash className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">{item.tag}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{item.count}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <h3 className="font-semibold flex items-center gap-2">
                  <Award className="h-4 w-4" />
                  Top Contributors
                </h3>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {[
                    { username: "PhoenixRising", posts: 24, elo: 1480 },
                    { username: "ShadowNinja", posts: 18, elo: 1380 },
                    { username: "EliteSniper", posts: 15, elo: 1420 },
                  ].map((user, index) => (
                    <div key={user.username} className="flex items-center gap-3">
                      <span className="text-xs font-bold text-muted-foreground w-4">
                        {index + 1}
                      </span>
                      <div className="flex-1">
                        <span className="text-sm font-medium">{user.username}</span>
                        <div className="text-xs text-muted-foreground">
                          {user.posts} posts · ELO {user.elo}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <h3 className="font-semibold flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Community Stats
                </h3>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  <div className="text-center p-3 bg-muted/30 rounded-lg">
                    <div className="text-xl font-bold">12.5K</div>
                    <div className="text-xs text-muted-foreground">Members</div>
                  </div>
                  <div className="text-center p-3 bg-muted/30 rounded-lg">
                    <div className="text-xl font-bold">3.2K</div>
                    <div className="text-xs text-muted-foreground">Online</div>
                  </div>
                  <div className="text-center p-3 bg-muted/30 rounded-lg">
                    <div className="text-xl font-bold">847</div>
                    <div className="text-xs text-muted-foreground">Posts Today</div>
                  </div>
                  <div className="text-center p-3 bg-muted/30 rounded-lg">
                    <div className="text-xl font-bold">156</div>
                    <div className="text-xs text-muted-foreground">Active Threads</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}