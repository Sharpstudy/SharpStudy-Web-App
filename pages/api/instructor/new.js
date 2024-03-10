// import jwt from "jsonwebtoken";
// import User from "database/models/user";
// import { instructorRequest } from "../../../email-templates/instructor-request";

// export default async function handler(req, res) {
//   if (!("authorization" in req.headers)) {
//     return res.status(401).json({ message: "No autorization token" });
//   }
//   switch (req.method) {
//     case "PUT":
//       await handlePut(req, res);
//       break;

//     default:
//       res.status(405).json({
//         message: `Method ${req.method} not allowed`,
//       });
//   }
// }

// const handlePut = async (req, res) => {
//   const { name, email, phone, instructor_subject, instructor_description } =
//     req.body;
//   console.log('=============', name);
//   console.log('============= req.headers.authorization', req.headers.authorization);
//   try {
//     // Extract the bearer token from the authorization header
//     const token = req.headers.authorization.split(" ")[1];
//     if (!token) {
//       return res.status(401).json({ message: "No authorization token provided" });
//     }

//     const { userId } = jwt.verify(
//       req.headers.authorization,
//       process.env.JWT_SECRET
//     );
//     console.log('===========UserID', userId);
//     const user = await User.findOne({
//       where: { id: userId, instructor_request: true },
//     });

//     const admins = await User.findAll({
//       where: { role: "admin" },
//     });

//     if (user) {
//       res.status(422).json({ message: "Already sent a request." });
//     } else {
//       const instructor = await User.update(
//         {
//           instructor_request: true,
//           instructor_subject,
//           instructor_description,
//           phone,
//         },
//         { where: { id: userId } }
//       );

//       admins.forEach((admin) => {
//         // console.log(admin.email);
//         instructorRequest(
//           admin.email,
//           name,
//           email,
//           instructor_subject,
//           instructor_description
//         );
//       });

//       res.status(200).json({
//         message: "Recieved a request and we will back to you soon.",
//         instructor,
//       });
//     }
//   } catch (e) {
//     // console.log(e);
//     res.status(400).json({
//       error_code: "get_students",
//       message: e.message,
//     });
//   }
// };


// import jwt from "jsonwebtoken";
// import User from "database/models/user";
// import { instructorRequest } from "../../../email-templates/instructor-request";

// export default async function handler(req, res) {
//   try {
//     // Extract the bearer token from the authorization header
//     const token = req.headers.authorization.split(" ")[1];
//     if (!token) {
//       return res.status(401).json({ message: "No authorization token provided" });
//     }

//     // Decode the token to extract the user ID
//     const { userId } = jwt.verify(token, process.env.JWT_SECRET);

//     switch (req.method) {
//       case "PUT":
//         await handlePut(req, res, userId); // Pass the userId to handlePut function
//         break;

//       default:
//         res.status(405).json({
//           message: `Method ${req.method} not allowed`,
//         });
//     }
//   } catch (error) {
//     console.error("Error:", error.message);
//     res.status(401).json({ message: "Invalid or expired token" });
//   }
// }

// const handlePut = async (req, res, userId) => {
//   const { name, email, phone, instructor_subject, instructor_description } = req.body;

//   try {
//     // Check if the user with the extracted userId exists and has instructor_request as true
//     const user = await User.findOne({ where: { id: userId, instructor_request: true } });
//     if (user) {
//       return res.status(422).json({ message: "Already sent a request." });
//     }

//     // Update the user record to indicate the instructor request
//     await User.update(
//       {
//         instructor_request: true,
//         instructor_subject,
//         instructor_description,
//         phone,
//       },
//       { where: { id: userId } }
//     );

//     // Fetch admin users
//     const admins = await User.findAll({ where: { role: "admin" } });

//     // Notify admins about the new instructor request
//     admins.forEach((admin) => {
//       instructorRequest(admin.email, name, email, instructor_subject, instructor_description);
//     });

//     res.status(200).json({
//       message: "Received a request and we will get back to you soon.",
//     });
//   } catch (error) {
//     console.error("Error:", error.message);
//     res.status(500).json({ message: "Internal server error, failed to submit the request" });
//   }
// };



// import jwt from "jsonwebtoken";
// import User from "database/models/user";
// import { instructorRequest } from "../../../email-templates/instructor-request";

// export default async function handler(req, res) {
//   console.log('=============> Req', req);
//   try {
//     let token;
//     // Check if the request is coming from Swagger Docs or UI
//     if ("authorization" in req.headers) {
//       // Extract the bearer token from the authorization header
//       token = req.headers.authorization.split(" ")[1];
//     } else {
//       // For UI request, extract token from the request body
//       token = req.body.token;
//     }

//     if (!token) {
//       return res.status(401).json({ message: "No authorization token provided" });
//     }

//     // Decode the token to extract the user ID
//     const { userId } = jwt.verify(token, process.env.JWT_SECRET);

//     switch (req.method) {
//       case "PUT":
//         await handlePut(req, res, userId); // Pass the userId to handlePut function
//         break;

//       default:
//         res.status(405).json({
//           message: `Method ${req.method} not allowed`,
//         });
//     }
//   } catch (error) {
//     console.error("Error:", error.message);
//     res.status(401).json({ message: "Invalid or expired token" });
//   }
// }

// const handlePut = async (req, res, userId) => {
//   const { name, email, phone, instructor_subject, instructor_description } = req.body;

//   try {
//     // Check if the user with the extracted userId exists and has instructor_request as true
//     const user = await User.findOne({ where: { id: userId, instructor_request: true } });
//     if (user) {
//       return res.status(422).json({ message: "Already sent a request." });
//     }

//     // Update the user record to indicate the instructor request
//     await User.update(
//       {
//         instructor_request: true,
//         instructor_subject,
//         instructor_description,
//         phone,
//       },
//       { where: { id: userId } }
//     );

//     // Fetch admin users
//     const admins = await User.findAll({ where: { role: "admin" } });

//     // Notify admins about the new instructor request
//     admins.forEach((admin) => {
//       instructorRequest(admin.email, name, email, instructor_subject, instructor_description);
//     });

//     res.status(200).json({
//       message: "Received a request and we will get back to you soon.",
//     });
//   } catch (error) {
//     console.error("Error:", error.message);
//     res.status(500).json({ message: "Internal server error, failed to submit the request" });
//   }
// };



/* This works for the UI */
import jwt from "jsonwebtoken";
import User from "database/models/user";
import { instructorRequest } from "../../../email-templates/instructor-request";

export default async function handler(req, res) {
  if (!("authorization" in req.headers)) {
    return res.status(401).json({ message: "No autorization token" });
  }
  switch (req.method) {
    case "PUT":
      await handlePut(req, res);
      break;

    default:
      res.status(405).json({
        message: `Method ${req.method} not allowed`,
      });
  }
}
const handlePut = async (req, res) => {
  console.log("Headers:", req.headers.authorization);
  const { name, email, phone, instructor_subject, instructor_description } = req.body;
  try {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      // Token comes from the UI or Swagger docs
      token = req.headers.authorization.split(' ')[1];
      console.log('token', token);
    } else if (req.headers.authorization) {
      // Token comes without the "Bearer " prefix
      token = req.headers.authorization;
    } else {
      return res.status(401).json({ message: "Invalid or missing authorization header" });
    }

    // Verify the token using the extracted token variable
    const { userId } = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findOne({
      where: { id: userId, instructor_request: true },
    });

    const admins = await User.findAll({
      where: { role: "admin" },
    });

    if (user) {
      res.status(422).json({ message: "Already sent a request." });
    } else {
      const instructor = await User.update(
        {
          instructor_request: true,
          instructor_subject,
          instructor_description,
          phone,
        },
        { where: { id: userId } }
      );

      admins.forEach((admin) => {
        instructorRequest(
          admin.email,
          name,
          email,
          instructor_subject,
          instructor_description
        );
      });

      res.status(200).json({
        message: "Received a request and we will get back to you soon.",
        instructor,
      });
    }
  } catch (error) {
    console.error('JWT verification error:', error);
    res.status(400).json({
      error_code: "get_students",
      message: error.message,
    });
  }
};





// const handlePut = async (req, res) => {
// 	const { name, email, phone, instructor_subject, instructor_description } =
// 		req.body;
// 	try {
// 		const { userId } = jwt.verify(
// 			req.headers.authorization,
// 			process.env.JWT_SECRET
// 		);

// 		const user = await User.findOne({
// 			where: { id: userId, instructor_request: true },
// 		});

// 		const admins = await User.findAll({
// 			where: { role: "admin" },
// 		});

// 		if (user) {
// 			res.status(422).json({ message: "Already sent a request." });
// 		} else {
// 			const instructor = await User.update(
// 				{
// 					instructor_request: true,
// 					instructor_subject,
// 					instructor_description,
// 					phone,
// 				},
// 				{ where: { id: userId } }
// 			);

// 			admins.forEach((admin) => {
// 				// console.log(admin.email);
// 				instructorRequest(
// 					admin.email,
// 					name,
// 					email,
// 					instructor_subject,
// 					instructor_description
// 				);
// 			});

// 			res.status(200).json({
// 				message: "Recieved a request and we will back to you soon.",
// 				instructor,
// 			});
// 		}
// 	} catch (e) {
// 		// console.log(e);
// 		res.status(400).json({
// 			error_code: "get_students",
// 			message: e.message,
// 		});
// 	}
// };