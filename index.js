import AWS from "aws-sdk";
import axios from "axios";
import nodemailer from "nodemailer";
import mailgunTransport from "nodemailer-mailgun-transport";
import { Storage } from "@google-cloud/storage";

import dotenv from "dotenv";
dotenv.config();

const cred = Buffer.from(process.env.GOOGLE_CREDENTIALS, "base64").toString(
  "ascii"
);
const gcpPrivateKey = JSON.parse(cred).private_key.replace(/\\n/g, "\n");

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const gcsBucket = process.env.BUCKET_NAME;

console.log("1");

const gcs = new Storage({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_MAIL,
    private_key: gcpPrivateKey,
  },
  projectId: process.env.GOOGLE_PROJECT_ID,
});

console.log("2");

export const handler = async (event) => {
  
  var snsMessage;
  try {
    // Parse SNS message
    if (
      !event.Records ||
      !event.Records[0] ||
      !event.Records[0].Sns ||
      !event.Records[0].Sns.Message
    ) {
      throw new Error("Invalid event structure");
    }
    snsMessage = JSON.parse(event.Records[0].Sns.Message);

    // Download release from GitHub
    const githubResponse = await axios.get(`${snsMessage.url}`, {
      responseType: "arraybuffer",
    });

    console.log("3");

    // Upload to Google Cloud Storage
    const gcsFile = gcs.bucket(gcsBucket).file(`releases/${Date.now()}.zip`);
    await gcsFile.save(githubResponse.data);

    console.log("4");

    // Send email notification
    await sendEmail(`Release downloaded and stored. Path - ${gcsFile.path}`, snsMessage.user.email);

    // Record in DynamoDB
    await recordInDynamoDB(`${Date.now()}`, "Success");

    console.log("5");

    return { statusCode: 200, body: "Process completed successfully" };
  
  } catch (error) {
    //mail to yoursself with error flow
    console.log("5.*");
    console.error("Error:", error); 
    await sendEmail(`Error in processing release. Invalid url ${snsMessage.url}`, snsMessage.user.email);
    await recordInDynamoDB(`${Date.now()}`, "Failed");
    return { statusCode: 500, body: "Error in process" };
  }
};

async function sendEmail(message, recipient) {
  console.log("4.1");
  
  const mailgunOptions = {
    auth: {
      api_key: process.env.MAILGUN_KEY, 
      domain: process.env.MAILGUN_DOMAIN,
    },
  };

  var transporter = nodemailer.createTransport(mailgunTransport(mailgunOptions));

  console.log("4.2");

  const mailOptions = {
    from: process.env.MAILGUN_SENDER, // Replace with your email
    to: recipient, // Replace with recipient email address
    subject: "Github submission",
    text: message,
  };

  console.log("4.3");

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.log("4.3.1");
      console.error(`Error: ${error}`);
    } else {
      console.log("4.3.2");
      console.log(`Message sent: ${info.messageId}`);
    }
  });

  console.log("4.4");
}

async function recordInDynamoDB(releaseTag, status) {
  console.log("4.5");

  const params = {
    TableName: process.env.DYNAMODB_TABLE,
    Item: {
      id: process.env.DYNAMODB_TABLE_ID,
      ReleaseTag: releaseTag,
      Timestamp: new Date().toISOString(),
      Status: status,
    },
  };

  console.log(params);

  console.log("4.6");
  return await dynamoDB.put(params).promise();
}
