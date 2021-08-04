/**
 * Remarkie App.
 * @author James Grams
 */

const fs = require("fs").promises;
const fsStandard = require("fs");
const {google} = require("googleapis");
const Remarkable = require("remarkable-typescript").Remarkable;
const libre = require('libreoffice-convert');
const PDFDocument = require("pdfkit");
const readline = require("readline");
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});
const question = (text) => {
    return new Promise(resolve => {
        rl.question(text, resolve);
    });
}
const FileType = require("file-type");
const MIMEText = require("mimetext");
require('dotenv').config();

const SCOPES = ['https://mail.google.com/'];
const CREDENTIALS_PATH = "credentials.json";
const GOOGLE_TOKEN_PATH = "google-token.json";
const REMARKABLE_TOKEN_PATH = ".remarkable-token";
const TEMP_IMAGE_PATH = "temp";
const TEMP_PDF_PATH = "temp.pdf";
const REMARKABLE_URL = "https://my.remarkable.com/device/connect/desktop";
const IMAGE_EXTENSIONS = ["tif","tiff","bmp","jpg","jpeg","gif","png","eps","webp","jpe","jif","jfif","jfi","dib","heif","heic","svg","svgz"];
const OFFICE_EXTENSIONS = ["doc","docx","xls","xlsx", "ppt", "pptx"];
const CHECK_INTERVAL = 1000 * 60 * 2; // 2 minutes between checks

const ERROR_MESSAGES = {
    "unsupportedFileType": "Unsupported File Type"
}

/**
 * Main program.
 */
async function main() {
    monitor();
}

main();

/**
 * Monitor the gmail account for new emails. 
 */
async function monitor() {
    if( process.argv[2] ) {
        await convert( (await fs.readFile(process.argv[2].toString())) );
        rl.close();
    }
    else {
        let auth = await loginGoogle();
        let gmail = google.gmail({version: "v1", auth: auth});
        let remarkable = await loginRemarkable();
        rl.close();

        let seen = {};
        let start = Date.now();
        async function check() {
            try {
                let messages = await gmail.users.messages.list({
                    userId: "me"
                });
                console.log("Reading messages");
                for( let message of messages.data.messages ) {
                    try {
                        let messageData = await gmail.users.messages.get({
                            id: message.id,
                            userId: "me"
                        });

                        async function sendMail( body ) {
                            try {
                                let subject = messageData.data.payload.headers.filter(el => el.name === "Subject")[0].value;
                                let from = messageData.data.payload.headers.filter(el => el.name === "To")[0].value;
                                let to = messageData.data.payload.headers.filter(el => el.name === "From")[0].value;
                                let mail = new MIMEText();
                                mail.setSender(from);
                                mail.setRecipient(to);
                                mail.setSubject(subject);
                                mail.setMessage(body);
                                let messageId = messageData.data.payload.headers.filter(el => el.name === "Message-ID")[0].value;
                                let references = messageData.data.payload.headers.filter(el => el.name === "References");
                                if( references.length ) {
                                    references = references[0].value + " " + messageId;
                                }
                                else references = messageId;
                                mail.setHeaders({
                                    "In-Reply-To": messageId,
                                    "References": references
                                });
                                await gmail.users.messages.send({
                                    userId: "me",
                                    requestBody: {
                                        raw: mail.asEncoded(),
                                        threadId: message.threadId
                                    }
                                });
                                console.log("Response sent");
                            }
                            catch(err) {
                                console.log("Could not send email");
                            }
                            return Promise.resolve();
                        }

                        let messageDate = new Date(messageData.data.payload.headers.filter(el => el.name === "Date")[0].value);
                        if( messageDate < start ) continue;
                        if( seen[message.id] ) continue;
                        if( !messageData.data.payload.parts ) continue;
                        for( let part of messageData.data.payload.parts ) {
                            if( part.filename && part.body.attachmentId ) {
                                console.log("Found attachment");
                                let attachment = await gmail.users.messages.attachments.get({
                                    id: part.body.attachmentId,
                                    messageId: message.id,
                                    userId: "me"
                                });
                                //console.log(attachment);
                                console.log("Converting attachment");
                                try {
                                    await convert( Buffer.from(attachment.data.data, 'base64') );
                                }
                                catch(err) {
                                    console.log(err);
                                    await sendMail("Failed to convert to PDF 🙁");
                                }
                                console.log("Uploading attachment");
                                let upload = async function() {
                                    await remarkable.uploadPDF( part.filename + " - " + new Date().toLocaleString(), await fs.readFile(TEMP_PDF_PATH) );
                                    console.log("Uploaded");
                                    await sendMail("Upload Successful 🙂");
                                    return Promise.resolve();
                                }
                                try {
                                    await upload();
                                }
                                catch(err) {
                                    console.log("Error uploading PDF, trying to log in to reMarkable again");
                                    remarkable = await loginRemarkable();
                                    try {
                                        await upload();
                                    }
                                    catch(err) {
                                        console.log("Remarkable couldn't be logged into");
                                        await sendMail("Could not upload to reMarkable 🙁");
                                    }
                                }
                            }
                        }
                        seen[message.id] = true;
                    }
                    catch(err) {
                        console.log(err);
                    }
                }
            }
            catch(err) {
                console.log(err);
                try {
                    console.log("Error, trying to log in to Google again");
                    auth = await loginGoogle();
                    gmail = google.gmail({version: "v1", auth: auth});
                }
                catch(err) {
                    console.log(err);
                }
            }
            console.log("Messages read");
            setTimeout( check, CHECK_INTERVAL );
        }
        check();
    }
}

/**
 * Login to Google.
 * @returns {Promise<google.auth.OAuth2>} An authorized OAuth2 Client.
 */
async function loginGoogle() {
    let credentials = JSON.parse(await fs.readFile(CREDENTIALS_PATH));
    let oAuth2Client = new google.auth.OAuth2(credentials.installed.client_id, credentials.installed.client_secret, credentials.installed.redirect_uris[0]);
    try {
        let token = JSON.parse(await fs.readFile(GOOGLE_TOKEN_PATH));
        oAuth2Client.setCredentials(token);
    }
    catch(err) {
        await getNewToken( oAuth2Client );
    }
    return Promise.resolve( oAuth2Client );
}

/**
 * Get a new Google OAuth2 Token.
 * @param {google.auth.OAuth2} oAuth2Client - The OAuth2 client.
 * @returns {Promise<google.auth.OAuth2>} An authorized OAuth2 Client.
 */
async function getNewToken(oAuth2Client) {
    let authUrl = oAuth2Client.generateAuthUrl({
        access_type: "offline",
        scope: SCOPES
    });
    console.log("Please authorize this app by using this url: " + authUrl);
    let code = await question("Please enter the code from that page here: ");
    let token = (await oAuth2Client.getToken(code)).tokens;
    oAuth2Client.setCredentials(token);
    fs.writeFile( GOOGLE_TOKEN_PATH, JSON.stringify(token) );
    return Promise.resolve( oAuth2Client );
}

/**
 * Login to reMarkable.
 * @returns {Remarkable} An authroized reMarkable client.
 */
async function loginRemarkable() {
    let client;
    try {
        let deviceToken = (await fs.readFile(REMARKABLE_TOKEN_PATH)).toString();
        client = new Remarkable({deviceToken: deviceToken});
        await client.refreshToken();
    }
    catch(err) {
        console.log("Please visit this URL and generate a code: " + REMARKABLE_URL);
        let code = await question("Please enter the code from that page here: ");
        client = new Remarkable();
        let deviceToken = await client.register({code: code});
        await fs.writeFile(REMARKABLE_TOKEN_PATH, deviceToken);
    }
    return Promise.resolve(client);
}

/**
 * Covert a file to PDF.
 * @param {File} file - The file to convert to pdf.
 */
async function convert( file ) {
    let fileType = await FileType.fromBuffer( file );
    if( IMAGE_EXTENSIONS.indexOf(fileType.ext) !== -1 ) {
        await fs.writeFile(TEMP_IMAGE_PATH, file);
        let pdf = new PDFDocument({
            autoFirstPage: false
        });
        pdf.pipe( fsStandard.createWriteStream(TEMP_PDF_PATH) );
        let img = await pdf.openImage(TEMP_IMAGE_PATH);
        pdf.addPage({
            size: [img.width, img.height]
        });
        pdf.image(img, 0, 0);
        pdf.end();
        
        return Promise.resolve();
    }
    else if( OFFICE_EXTENSIONS.indexOf(fileType.ext) !== -1 ) {
        return new Promise( (resolve, reject) => {
            libre.convert(file, ".pdf", undefined, async (err,done) => {
                if( err ) reject();
                await fs.writeFile(TEMP_PDF_PATH, done);
                resolve();
            });
        } );
    }
    else if( fileType.ext === "pdf" ) {
        await fs.writeFile(TEMP_PDF_PATH, file);
        return Promise.resolve();
    }
    else return Promise.reject(ERROR_MESSAGES.unsupportedFileType);
}
