import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Plus, BookOpen, Trash2, Edit, GraduationCap, Headphones, Library, ExternalLink
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Book {
  id: string;
  title: string;
  author: string | null;
  platforms: string[] | null;
  status: "to_read" | "reading" | "finished";
  notes: string | null;
  createdAt: string;
}

interface Course {
  id: string;
  title: string;
  instructor: string | null;
  platform: string | null;
  url: string | null;
  status: "not_started" | "in_progress" | "completed";
  progress: number;
  notes: string | null;
  createdAt: string;
}

interface Podcast {
  id: string;
  title: string;
  host: string | null;
  platform: string | null;
  url: string | null;
  status: "listening" | "completed" | "dropped";
  notes: string | null;
  createdAt: string;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const bookStatusConfig = {
  to_read: { label: "To Read", color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
  reading: { label: "Reading", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" },
  finished: { label: "Finished", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
};

const courseStatusConfig = {
  not_started: { label: "Not Started", color: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200" },
  in_progress: { label: "In Progress", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" },
  completed: { label: "Completed", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
};

const podcastStatusConfig = {
  listening: { label: "Listening", color: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200" },
  completed: { label: "Completed", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
  dropped: { label: "Dropped", color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
};

const bookPlatformConfig: Record<string, { label: string; color: string }> = {
  kindle: { label: "Kindle", color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" },
  audible: { label: "Audible", color: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200" },
  physical: { label: "Physical", color: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200" },
};

// ─── Books Tab ────────────────────────────────────────────────────────────────

function BooksTab() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState("all");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingBook, setEditingBook] = useState<Book | null>(null);
  const [formData, setFormData] = useState({
    title: "", author: "", platforms: [] as string[],
    status: "to_read" as Book["status"], notes: "",
  });

  const { data: books = [], isLoading } = useQuery<Book[]>({ queryKey: ["/api/books"] });

  const createMutation = useMutation({
    mutationFn: (data: typeof formData) => apiRequest("POST", "/api/books", data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/books"] }); closeModal(); toast({ title: "Book added" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Book> }) => apiRequest("PATCH", `/api/books/${id}`, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/books"] }),
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/books/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/books"] }); toast({ title: "Book deleted" }); },
  });

  const booksArray = Array.isArray(books) ? books : [];
  const filtered = booksArray.filter((b) => {
    if (statusFilter !== "all" && b.status !== statusFilter) return false;
    if (platformFilter !== "all") {
      const p = Array.isArray(b.platforms) ? b.platforms : [];
      if (!p.includes(platformFilter)) return false;
    }
    return true;
  });

  const grouped = {
    reading: filtered.filter((b) => b.status === "reading"),
    to_read: filtered.filter((b) => b.status === "to_read"),
    finished: filtered.filter((b) => b.status === "finished"),
  };

  const openModal = (book?: Book) => {
    if (book) {
      setEditingBook(book);
      setFormData({ title: book.title, author: book.author || "", platforms: Array.isArray(book.platforms) ? book.platforms : [], status: book.status, notes: book.notes || "" });
    } else {
      setEditingBook(null);
      setFormData({ title: "", author: "", platforms: [], status: "to_read", notes: "" });
    }
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingBook(null);
    setFormData({ title: "", author: "", platforms: [], status: "to_read", notes: "" });
  };

  const handleSubmit = () => {
    if (!formData.title.trim()) { toast({ title: "Title is required", variant: "destructive" }); return; }
    if (editingBook) { updateMutation.mutate({ id: editingBook.id, data: formData }); closeModal(); toast({ title: "Book updated" }); }
    else createMutation.mutate(formData);
  };

  const togglePlatform = (platform: string) => {
    setFormData((prev) => ({
      ...prev,
      platforms: prev.platforms.includes(platform) ? prev.platforms.filter((p) => p !== platform) : [...prev.platforms, platform],
    }));
  };

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div className="flex flex-wrap gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="reading">Reading</SelectItem>
              <SelectItem value="to_read">To Read</SelectItem>
              <SelectItem value="finished">Finished</SelectItem>
            </SelectContent>
          </Select>
          <Select value={platformFilter} onValueChange={setPlatformFilter}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="Platform" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Platforms</SelectItem>
              <SelectItem value="kindle">Kindle</SelectItem>
              <SelectItem value="audible">Audible</SelectItem>
              <SelectItem value="physical">Physical</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => openModal()}>
          <Plus className="h-4 w-4 mr-2" />Add Book
        </Button>
      </div>

      {(["reading", "to_read", "finished"] as const).map((status) => {
        const statusBooks = grouped[status];
        if (statusBooks.length === 0) return null;
        return (
          <Card key={status}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Badge className={bookStatusConfig[status].color}>{bookStatusConfig[status].label}</Badge>
                <span className="text-muted-foreground font-normal text-sm">({statusBooks.length})</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {statusBooks.map((book) => {
                  const platforms = Array.isArray(book.platforms) ? book.platforms : [];
                  return (
                    <div key={book.id} className="flex items-center gap-3 p-3 rounded-lg border hover:bg-accent transition-colors">
                      <BookOpen className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium">{book.title}</p>
                        {book.author && <p className="text-sm text-muted-foreground">by {book.author}</p>}
                        <div className="flex flex-wrap items-center gap-2 mt-1">
                          {platforms.map((p) => (
                            <Badge key={p} variant="outline" className={`text-xs ${bookPlatformConfig[p]?.color || ""}`}>
                              {bookPlatformConfig[p]?.label || p}
                            </Badge>
                          ))}
                          <span className="text-xs text-muted-foreground">Added {format(new Date(book.createdAt), "MMM d, yyyy")}</span>
                        </div>
                        {book.notes && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{book.notes}</p>}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Select value={book.status} onValueChange={(v) => updateMutation.mutate({ id: book.id, data: { status: v as Book["status"] } })}>
                          <SelectTrigger className="w-[120px] h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="to_read">To Read</SelectItem>
                            <SelectItem value="reading">Reading</SelectItem>
                            <SelectItem value="finished">Finished</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openModal(book)}><Edit className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => deleteMutation.mutate(book.id)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {filtered.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <BookOpen className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No books found</h3>
            <p className="text-muted-foreground mb-4">
              {statusFilter === "all" && platformFilter === "all" ? "Your book list is empty." : "No books match the current filters."}
            </p>
            <Button onClick={() => openModal()}><Plus className="h-4 w-4 mr-2" />Add First Book</Button>
          </CardContent>
        </Card>
      )}

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingBook ? "Edit Book" : "Add Book"}</DialogTitle>
            <DialogDescription className="sr-only">{editingBook ? "Edit book details" : "Add a new book"}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="book-title">Title *</Label>
              <Input id="book-title" value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })} placeholder="Book title" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="book-author">Author</Label>
              <Input id="book-author" value={formData.author} onChange={(e) => setFormData({ ...formData, author: e.target.value })} placeholder="Author name" />
            </div>
            <div className="space-y-2">
              <Label>Platforms</Label>
              <div className="flex flex-wrap gap-4 pt-1">
                {["kindle", "audible", "physical"].map((p) => (
                  <div key={p} className="flex items-center gap-2">
                    <Checkbox id={`plat-${p}`} checked={formData.platforms.includes(p)} onCheckedChange={() => togglePlatform(p)} />
                    <Label htmlFor={`plat-${p}`} className="cursor-pointer font-normal capitalize">{p === "physical" ? "Physical Copy" : p.charAt(0).toUpperCase() + p.slice(1)}</Label>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="book-status">Status</Label>
              <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v as Book["status"] })}>
                <SelectTrigger id="book-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="to_read">To Read</SelectItem>
                  <SelectItem value="reading">Reading</SelectItem>
                  <SelectItem value="finished">Finished</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="book-notes">Notes</Label>
              <Textarea id="book-notes" value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} placeholder="Thoughts, highlights..." rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeModal}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending}>
              {editingBook ? "Save Changes" : "Add Book"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Courses Tab ──────────────────────────────────────────────────────────────

function CoursesTab() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState("all");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [formData, setFormData] = useState({
    title: "", instructor: "", platform: "", url: "",
    status: "not_started" as Course["status"], progress: 0, notes: "",
  });

  const { data: courseList = [], isLoading } = useQuery<Course[]>({ queryKey: ["/api/courses"] });

  const createMutation = useMutation({
    mutationFn: (data: typeof formData) => apiRequest("POST", "/api/courses", data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/courses"] }); closeModal(); toast({ title: "Course added" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Course> }) => apiRequest("PATCH", `/api/courses/${id}`, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/courses"] }),
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/courses/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/courses"] }); toast({ title: "Course deleted" }); },
  });

  const courses = Array.isArray(courseList) ? courseList : [];
  const filtered = courses.filter((c) => statusFilter === "all" || c.status === statusFilter);

  const grouped = {
    in_progress: filtered.filter((c) => c.status === "in_progress"),
    not_started: filtered.filter((c) => c.status === "not_started"),
    completed: filtered.filter((c) => c.status === "completed"),
  };

  const openModal = (course?: Course) => {
    if (course) {
      setEditingCourse(course);
      setFormData({ title: course.title, instructor: course.instructor || "", platform: course.platform || "", url: course.url || "", status: course.status, progress: course.progress, notes: course.notes || "" });
    } else {
      setEditingCourse(null);
      setFormData({ title: "", instructor: "", platform: "", url: "", status: "not_started", progress: 0, notes: "" });
    }
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingCourse(null);
    setFormData({ title: "", instructor: "", platform: "", url: "", status: "not_started", progress: 0, notes: "" });
  };

  const handleSubmit = () => {
    if (!formData.title.trim()) { toast({ title: "Title is required", variant: "destructive" }); return; }
    if (editingCourse) { updateMutation.mutate({ id: editingCourse.id, data: formData }); closeModal(); toast({ title: "Course updated" }); }
    else createMutation.mutate(formData);
  };

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="not_started">Not Started</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={() => openModal()}>
          <Plus className="h-4 w-4 mr-2" />Add Course
        </Button>
      </div>

      {(["in_progress", "not_started", "completed"] as const).map((status) => {
        const statusCourses = grouped[status];
        if (statusCourses.length === 0) return null;
        return (
          <Card key={status}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Badge className={courseStatusConfig[status].color}>{courseStatusConfig[status].label}</Badge>
                <span className="text-muted-foreground font-normal text-sm">({statusCourses.length})</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {statusCourses.map((course) => (
                  <div key={course.id} className="flex items-start gap-3 p-3 rounded-lg border hover:bg-accent transition-colors">
                    <GraduationCap className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium">{course.title}</p>
                        {course.url && (
                          <a href={course.url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                      {course.instructor && <p className="text-sm text-muted-foreground">by {course.instructor}</p>}
                      {course.platform && <Badge variant="outline" className="text-xs mt-1">{course.platform}</Badge>}
                      {course.status === "in_progress" && (
                        <div className="mt-2">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-muted-foreground">Progress</span>
                            <span className="text-xs font-medium">{course.progress}%</span>
                          </div>
                          <Progress value={course.progress} className="h-1.5" />
                        </div>
                      )}
                      {course.notes && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{course.notes}</p>}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Select value={course.status} onValueChange={(v) => updateMutation.mutate({ id: course.id, data: { status: v as Course["status"] } })}>
                        <SelectTrigger className="w-[130px] h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="not_started">Not Started</SelectItem>
                          <SelectItem value="in_progress">In Progress</SelectItem>
                          <SelectItem value="completed">Completed</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openModal(course)}><Edit className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => deleteMutation.mutate(course.id)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {filtered.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <GraduationCap className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No courses found</h3>
            <p className="text-muted-foreground mb-4">
              {statusFilter === "all" ? "Your course list is empty." : "No courses match the current filter."}
            </p>
            <Button onClick={() => openModal()}><Plus className="h-4 w-4 mr-2" />Add First Course</Button>
          </CardContent>
        </Card>
      )}

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingCourse ? "Edit Course" : "Add Course"}</DialogTitle>
            <DialogDescription className="sr-only">{editingCourse ? "Edit course details" : "Add a new course"}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="course-title">Title *</Label>
              <Input id="course-title" value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })} placeholder="Course title" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="course-instructor">Instructor</Label>
              <Input id="course-instructor" value={formData.instructor} onChange={(e) => setFormData({ ...formData, instructor: e.target.value })} placeholder="Instructor name" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="course-platform">Platform</Label>
                <Input id="course-platform" value={formData.platform} onChange={(e) => setFormData({ ...formData, platform: e.target.value })} placeholder="e.g. Udemy, YouTube" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="course-status">Status</Label>
                <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v as Course["status"] })}>
                  <SelectTrigger id="course-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="not_started">Not Started</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="course-url">URL</Label>
              <Input id="course-url" value={formData.url} onChange={(e) => setFormData({ ...formData, url: e.target.value })} placeholder="https://..." />
            </div>
            {formData.status === "in_progress" && (
              <div className="space-y-2">
                <Label>Progress: {formData.progress}%</Label>
                <Slider
                  value={[formData.progress]}
                  onValueChange={([v]) => setFormData({ ...formData, progress: v })}
                  min={0} max={100} step={5}
                  className="py-1"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="course-notes">Notes</Label>
              <Textarea id="course-notes" value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} placeholder="Key takeaways, notes..." rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeModal}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending}>
              {editingCourse ? "Save Changes" : "Add Course"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Podcasts Tab ─────────────────────────────────────────────────────────────

function PodcastsTab() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState("all");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPodcast, setEditingPodcast] = useState<Podcast | null>(null);
  const [formData, setFormData] = useState({
    title: "", host: "", platform: "", url: "",
    status: "listening" as Podcast["status"], notes: "",
  });

  const { data: podcastList = [], isLoading } = useQuery<Podcast[]>({ queryKey: ["/api/podcasts"] });

  const createMutation = useMutation({
    mutationFn: (data: typeof formData) => apiRequest("POST", "/api/podcasts", data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/podcasts"] }); closeModal(); toast({ title: "Podcast added" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Podcast> }) => apiRequest("PATCH", `/api/podcasts/${id}`, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/podcasts"] }),
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/podcasts/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/podcasts"] }); toast({ title: "Podcast removed" }); },
  });

  const podcastsArr = Array.isArray(podcastList) ? podcastList : [];
  const filtered = podcastsArr.filter((p) => statusFilter === "all" || p.status === statusFilter);

  const grouped = {
    listening: filtered.filter((p) => p.status === "listening"),
    completed: filtered.filter((p) => p.status === "completed"),
    dropped: filtered.filter((p) => p.status === "dropped"),
  };

  const openModal = (podcast?: Podcast) => {
    if (podcast) {
      setEditingPodcast(podcast);
      setFormData({ title: podcast.title, host: podcast.host || "", platform: podcast.platform || "", url: podcast.url || "", status: podcast.status, notes: podcast.notes || "" });
    } else {
      setEditingPodcast(null);
      setFormData({ title: "", host: "", platform: "", url: "", status: "listening", notes: "" });
    }
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingPodcast(null);
    setFormData({ title: "", host: "", platform: "", url: "", status: "listening", notes: "" });
  };

  const handleSubmit = () => {
    if (!formData.title.trim()) { toast({ title: "Title is required", variant: "destructive" }); return; }
    if (editingPodcast) { updateMutation.mutate({ id: editingPodcast.id, data: formData }); closeModal(); toast({ title: "Podcast updated" }); }
    else createMutation.mutate(formData);
  };

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="listening">Listening</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="dropped">Dropped</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={() => openModal()}>
          <Plus className="h-4 w-4 mr-2" />Add Podcast
        </Button>
      </div>

      {(["listening", "completed", "dropped"] as const).map((status) => {
        const statusPodcasts = grouped[status];
        if (statusPodcasts.length === 0) return null;
        return (
          <Card key={status}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Badge className={podcastStatusConfig[status].color}>{podcastStatusConfig[status].label}</Badge>
                <span className="text-muted-foreground font-normal text-sm">({statusPodcasts.length})</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {statusPodcasts.map((podcast) => (
                  <div key={podcast.id} className="flex items-start gap-3 p-3 rounded-lg border hover:bg-accent transition-colors">
                    <Headphones className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium">{podcast.title}</p>
                        {podcast.url && (
                          <a href={podcast.url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                      {podcast.host && <p className="text-sm text-muted-foreground">by {podcast.host}</p>}
                      <div className="flex items-center gap-2 mt-1">
                        {podcast.platform && <Badge variant="outline" className="text-xs">{podcast.platform}</Badge>}
                        <span className="text-xs text-muted-foreground">Added {format(new Date(podcast.createdAt), "MMM d, yyyy")}</span>
                      </div>
                      {podcast.notes && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{podcast.notes}</p>}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Select value={podcast.status} onValueChange={(v) => updateMutation.mutate({ id: podcast.id, data: { status: v as Podcast["status"] } })}>
                        <SelectTrigger className="w-[120px] h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="listening">Listening</SelectItem>
                          <SelectItem value="completed">Completed</SelectItem>
                          <SelectItem value="dropped">Dropped</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openModal(podcast)}><Edit className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => deleteMutation.mutate(podcast.id)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {filtered.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Headphones className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No podcasts found</h3>
            <p className="text-muted-foreground mb-4">
              {statusFilter === "all" ? "Your podcast list is empty." : "No podcasts match the current filter."}
            </p>
            <Button onClick={() => openModal()}><Plus className="h-4 w-4 mr-2" />Add First Podcast</Button>
          </CardContent>
        </Card>
      )}

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingPodcast ? "Edit Podcast" : "Add Podcast"}</DialogTitle>
            <DialogDescription className="sr-only">{editingPodcast ? "Edit podcast details" : "Add a new podcast"}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="pod-title">Title *</Label>
              <Input id="pod-title" value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })} placeholder="Podcast name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pod-host">Host</Label>
              <Input id="pod-host" value={formData.host} onChange={(e) => setFormData({ ...formData, host: e.target.value })} placeholder="Host or creator name" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="pod-platform">Platform</Label>
                <Input id="pod-platform" value={formData.platform} onChange={(e) => setFormData({ ...formData, platform: e.target.value })} placeholder="e.g. Spotify, Apple" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pod-status">Status</Label>
                <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v as Podcast["status"] })}>
                  <SelectTrigger id="pod-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="listening">Listening</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="dropped">Dropped</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pod-url">URL</Label>
              <Input id="pod-url" value={formData.url} onChange={(e) => setFormData({ ...formData, url: e.target.value })} placeholder="https://..." />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pod-notes">Notes</Label>
              <Textarea id="pod-notes" value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} placeholder="Key episodes, takeaways..." rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeModal}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending}>
              {editingPodcast ? "Save Changes" : "Add Podcast"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LearningPage() {
  const { data: books = [] } = useQuery<Book[]>({ queryKey: ["/api/books"] });
  const { data: courseList = [] } = useQuery<Course[]>({ queryKey: ["/api/courses"] });
  const { data: podcastList = [] } = useQuery<Podcast[]>({ queryKey: ["/api/podcasts"] });

  const booksArr = Array.isArray(books) ? books : [];
  const coursesArr = Array.isArray(courseList) ? courseList : [];
  const podcastsArr = Array.isArray(podcastList) ? podcastList : [];

  const activeBooks = booksArr.filter((b) => b.status === "reading").length;
  const activeCourses = coursesArr.filter((c) => c.status === "in_progress").length;
  const activePodcasts = podcastsArr.filter((p) => p.status === "listening").length;
  const totalActive = activeBooks + activeCourses + activePodcasts;
  const totalItems = booksArr.length + coursesArr.length + podcastsArr.length;

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <GraduationCap className="h-8 w-8" />
            Learning Hub
          </h1>
          <p className="text-muted-foreground mt-1">
            {totalActive} active · {totalItems} total items
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900">
                <BookOpen className="h-5 w-5 text-blue-700 dark:text-blue-300" />
              </div>
              <div>
                <p className="text-2xl font-bold">{activeBooks}</p>
                <p className="text-xs text-muted-foreground">Reading now</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-yellow-100 dark:bg-yellow-900">
                <GraduationCap className="h-5 w-5 text-yellow-700 dark:text-yellow-300" />
              </div>
              <div>
                <p className="text-2xl font-bold">{activeCourses}</p>
                <p className="text-xs text-muted-foreground">In progress</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900">
                <Headphones className="h-5 w-5 text-purple-700 dark:text-purple-300" />
              </div>
              <div>
                <p className="text-2xl font-bold">{activePodcasts}</p>
                <p className="text-xs text-muted-foreground">Listening now</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="books">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="books" className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            Books
            {booksArr.length > 0 && <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1">{booksArr.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="courses" className="flex items-center gap-2">
            <GraduationCap className="h-4 w-4" />
            Courses
            {coursesArr.length > 0 && <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1">{coursesArr.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="podcasts" className="flex items-center gap-2">
            <Headphones className="h-4 w-4" />
            Podcasts
            {podcastsArr.length > 0 && <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1">{podcastsArr.length}</Badge>}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="books" className="mt-6">
          <BooksTab />
        </TabsContent>
        <TabsContent value="courses" className="mt-6">
          <CoursesTab />
        </TabsContent>
        <TabsContent value="podcasts" className="mt-6">
          <PodcastsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
