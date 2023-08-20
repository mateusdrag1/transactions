import { NextFunction, Request, Response } from "express";
import jwtService from "jsonwebtoken";
import { env } from "../env";

export const verifyJWT = (req: Request, res: Response, next: NextFunction) => {
  const jwt = req.headers["authorization"];

  if (!jwt) {
    return res.status(401).json({
      message: "JWT token is missing",
    });
  }

  const [prefix, token] = jwt.split(" ");

  if (prefix !== "Bearer") {
    return res.status(401).json({
      message: "Invalid JWT token",
    });
  }

  try {
    jwtService.verify(token, env.JWT_SECRET, (err, decoded) => {
      if (err) {
        return res.status(401).json({
          message: "Invalid JWT token",
        });
      }

      req.user = decoded as {
        id: string;
      };

      next();
    });
  } catch (error) {
    return res.status(401).json({
      message: "Invalid JWT token",
    });
  }
};
