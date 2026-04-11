/**
 * Courses Routes
 * CRUD operations for learning courses
 */
import { Router, Request, Response } from "express";
import { storage } from "../storage";
import { logger } from "../logger";
import { insertCourseSchema } from "@shared/schema";
import { z } from "zod";

const router = Router();

// Get all courses
router.get("/", async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string;
    const courseList = await storage.getCourses(status ? { status } : undefined);
    res.json(courseList);
  } catch (error) {
    logger.error({ error }, "Error fetching courses");
    res.status(500).json({ error: "Failed to fetch courses" });
  }
});

// Get single course
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const course = await storage.getCourse(String(req.params.id));
    if (!course) {
      return res.status(404).json({ error: "Course not found" });
    }
    res.json(course);
  } catch (error) {
    logger.error({ error }, "Error fetching course");
    res.status(500).json({ error: "Failed to fetch course" });
  }
});

// Create course
router.post("/", async (req: Request, res: Response) => {
  try {
    const validatedData = insertCourseSchema.parse(req.body);
    const course = await storage.createCourse(validatedData);
    res.status(201).json(course);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid course data", details: error.issues });
    } else {
      logger.error({ error }, "Error creating course");
      res.status(500).json({ error: "Failed to create course" });
    }
  }
});

// Update course
router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const updates = insertCourseSchema.partial().parse(req.body);
    const course = await storage.updateCourse(String(req.params.id), updates);
    if (!course) {
      return res.status(404).json({ error: "Course not found" });
    }
    res.json(course);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid course data", details: error.issues });
    } else {
      logger.error({ error }, "Error updating course");
      res.status(500).json({ error: "Failed to update course" });
    }
  }
});

// Delete course
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    await storage.deleteCourse(String(req.params.id));
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Error deleting course");
    res.status(500).json({ error: "Failed to delete course" });
  }
});

export default router;
