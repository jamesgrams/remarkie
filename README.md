# reMarkie

Email documents of any type to your reMarkable tablet.

reMarkie will try to convert documents that are sent (e.g. .docx, .pptx, .jpeg, .png etc.) to .pdf (if necessary), and then forward them to your Remarkable tablet. Works for Office file types, Images, and of course, PDFs.

# Setup

## What you'll need

1. A Gmail account
2. [A Gmail API enabled Google account & client credentials](https://developers.google.com/gmail/api/quickstart/nodejs)
    * Be sure to make the User Type "External" under OAuth Consent Screen
    * This can be the same account as the Gmail account, but it doesn't have to be
3. A reMarkable account.
4. A server/computer with Node.js installed to keep this program running.
5. LibreOffice installed on that computer too.

## Steps

1. Clone this repository
3. Save the `credentials.json` file you downloaded from creating OAuth credentials in Google Cloud Console to `credentials.json` in the root of this repository.
3. `cd` to this repository
4. `npm install`
    * At the time of writing this, reMarkable is going through some API changes. You may need to open the file `node_modules/remarkable-typescript/dist/src/remarkable.js` and replace `my.remarkable.com` with `webapp-production-dot-remarkable-production.appspot.com` if you are getting an error.
5. `npm start`
6. One first run, you may be prompted to log in with a browser with both Google and reMarkable and enter a code for future uses.


# Usage

Just send an email to the Gmail account you have created with an attachment. The program will try to convert the attachment and send it to your ReMarkable. It will email you back upon success or failure (if possible - i.e. the failure wasn't from not being able to connect to Gmail).