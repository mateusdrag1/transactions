import express from "express";
import { z } from "zod";
import { prisma } from "./services/Prisma";
import { hash, compare } from "bcrypt";
import jwt from "jsonwebtoken";
import { env } from "./env";
import { verifyJWT } from "./middleware/verifyJWT";
import axios, { HttpStatusCode } from "axios";
import { Prisma } from "@prisma/client";

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.json({
    message: "Serviço disponível",
  });
});

app.post("/users", async (req, res) => {
  const createUserBodySchema = z.object({
    name: z.string().min(3).max(255),
    email: z.string().email(),
    password: z.string().min(6).max(255),
    document: z
      .string()
      .regex(
        /^([0-9]{3}\.?[0-9]{3}\.?[0-9]{3}\-?[0-9]{2}|[0-9]{2}\.?[0-9]{3}\.?[0-9]{3}\/?[0-9]{4}\-?[0-9]{2})$/,
        "Document must be a valid CPF or CNPJ",
      ),
  });

  try {
    const { document, email, name, password } = createUserBodySchema.parse(
      req.body,
    );

    const userAlreadyExists = await prisma.user.findFirst({
      where: {
        OR: [
          {
            document,
          },
          {
            email,
          },
        ],
      },
    });

    if (userAlreadyExists) {
      return res.status(400).json({
        message: "User already exists",
      });
    }

    const passwordHash = await hash(password, 8);

    const user = await prisma.user.create({
      data: {
        document,
        email,
        name,
        password: passwordHash,
      },
    });

    return res.status(201).json(user);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        message: "Validation failed",
        errors: error.flatten().fieldErrors,
      });
    }
  }
});

app.get("/users", async (req, res) => {
  const users = await prisma.user.findMany();

  const usersWithLGPD = users.map((user) => {
    const { document, email, id, name } = user;

    return {
      document: document.replace(/(.{3})(.*)(.{2})/, "$1.***.***-$3"),
      email: email.replace(/(.{3})(.*)(@.*)/, "$1***$3"),
      id,
      name,
    };
  });

  return res.json({
    users: {
      count: users.length,
      data: usersWithLGPD,
    },
  });
});

app.post("/login", async (req, res) => {
  const loginBodySchema = z.object({
    email: z.string().email(),
    password: z.string().min(6).max(255),
  });

  try {
    const { email, password } = loginBodySchema.parse(req.body);

    const userAlreadyExists = await prisma.user.findFirst({
      where: {
        email,
      },
    });

    if (!userAlreadyExists) {
      throw new Error("Credentials failed");
    }

    const passwordVerify = await compare(password, userAlreadyExists.password);

    if (!passwordVerify) {
      throw new Error("Credentials failed");
    }

    const token = await jwt.sign(
      {
        id: userAlreadyExists.id,
      },
      env.JWT_SECRET,
    );

    return res.status(200).json({
      accessToken: token,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        message: "Validation Error",
        errors: error.flatten(),
      });
    }
  }
});

app.post("/transactions/send/:id", verifyJWT, async (req, res) => {
  const createTransactionBodySchema = z.object({
    amount: z.coerce.number().min(0.01),
  });

  const createTransactionParamsSchema = z.object({
    id: z.string().uuid(),
  });

  try {
    const { amount } = createTransactionBodySchema.parse(req.body);

    const { id } = createTransactionParamsSchema.parse(req.params);

    const [receiver, sender] = await Promise.all([
      prisma.user.findUnique({
        where: {
          id,
        },
      }),
      prisma.user.findUnique({
        where: {
          id: req.user.id,
        },
      }),
    ]);

    if (!receiver) {
      throw new Error("Receiver not found");
    }

    if (!sender) {
      throw new Error("Sender not found");
    }

    if (sender.id === receiver.id) {
      throw new Error("Sender and receiver can't be the same");
    }

    if (sender.role === "shopkeeper") {
      throw new Error("Shopkeepers can't send money");
    }

    const verifyTransactionHttp = await axios.get(
      "https://run.mocky.io/v3/8fafdd68-a090-496f-8c9a-3442cf30dae6",
    );

    if (
      verifyTransactionHttp.status === HttpStatusCode.Ok &&
      verifyTransactionHttp.data.message !== "Autorizado"
    ) {
      throw new Error("Transaction not authorized");
    }

    const transactionResult = await prisma.$transaction(
      async (transactionPrisma) => {
        await transactionPrisma.user.update({
          where: {
            id: sender.id,
            amount: {
              gte: amount,
            },
          },
          data: {
            amount: {
              decrement: amount,
            },
          },
        });

        const transaction = await transactionPrisma.payments.create({
          data: {
            amount,
            Receiver: {
              connect: {
                id: receiver.id,
              },
            },
            Sender: {
              connect: {
                id: sender.id,
              },
            },
          },
        });

        const updatedReceiver = await transactionPrisma.user.update({
          where: {
            id: receiver.id,
          },
          data: {
            amount: {
              increment: amount,
            },
          },
        });

        return { transaction, updatedReceiver };
      },
    );

    return res.status(201).json(transactionResult.transaction);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return res.status(400).json({
          message: "Insufficient funds",
        });
      }
    }

    if (error instanceof z.ZodError) {
      return res.status(400).json({
        message: "Validation failed",
        errors: error.flatten().fieldErrors,
      });
    }

    if (error instanceof Error) {
      return res.status(400).json({
        message: error.message,
      });
    }

    return res.status(500).json({
      message: "Internal server error",
    });
  }
});

app.listen(8080, () => {
  console.log("Server is running on port 8080");
});
