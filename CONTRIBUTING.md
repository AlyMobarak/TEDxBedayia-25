# CONTRIBUTING GUIDELINES - READ BEFORE YOU START

Hey, congratulations for making it onto the team! Quick reminder to use `npm run dev` while developing to check your changes in real time and fix any bugs before opening a pull request. Don't forget to use the .env file provided by your head.

### 🚨 CRITICAL WARNING FOR FUTURE TEAMS

**DO NOT CREATE A NEW REPOSITORY FOR THIS PROJECT.**

This repository is tightly coupled with our production infrastructure (Vercel) and domain configurations.

- ❌ **If you clone this to a new repo:** The website will stop updating, and you will break the SSL certificates and domain connection.
- ✅ **Instead:** You should request access to **this specific repository** from your team head or mentor.

---

### 🛠 How to Work on This Project

#### 1. The Golden Rule: PROTECT `main`

The `main` branch is the **Live Website**.

- **NEVER** push directly to `main`.
- **ALWAYS** create a new branch for your features.

#### 2. How to Submit Changes (The Workflow)

1.  **Create a Branch:**
    ```bash
    git checkout -b feature/my-new-feature
    ```
2.  **Code, Test, & Commit**

    ```bash
    npm run dev
    # Fix any bugs

    git add .
    git commit -m "feat: add new feature"
    ```

3.  **Push:**
    ```bash
    git push origin feature/my-new-feature
    ```
4.  **Open a Pull Request (PR):**
    - Go to the "Pull Requests" tab on GitHub.
    - Create a new PR from your branch to `main`.
    - **Request Review:** Assign the Team Head to review your code.

#### 3. Merging

- Once approved, the Team Head will merge your PR.
- **Vercel will automatically deploy** the new version to the live site immediately.

---

_Keep the legacy alive. Don't break the build._

## Installing Git

This is a local program, to be installed on your computer so that you save your changes. To actually "push" (i.e. upload) your code changes to GitHub, we have to tell the program Git where you'll be uploading and link it to your specific GitHub Account. This is covered in the Linking GitHub section.

### For Windows

1. Download [Git for Windows Installer](https://git-scm.com/install/windows).
2. After it downloads, run it.
3. Click next for the Terms and Conditions.
4. Click next for the installation place.
5. Click next twice until your reach choosing the default editor. Make sure you choose Visual Studio Code or whichever your preferred editor is.
6. Keep clicking next and adjusting any settings you need until you install the software.
7. Verify by opening Command Prompt from the search menu and typing `git --version`. Press enter and it should display the installed git version.

### For MacOS

1. Install [HomeBrew](https://brew.sh/).
2. Open Terminal and type `brew install git`.
3. Once it is done, run `git --version` to verify the installation. It should display the installed git version.

## Linking Git to GitHub

1. Open up your terminal or command prompt.
2. Run `ssh-keygen -t ed25519 -C "your_email@example.com"`, while replacing the email with your GitHub email.
3. Press Enter to accept the default file location.
4. Optionally, enter a passphrase (but this may break VSCode's git integration, so you can press enter twice without entering a password).
5. Copy the public key. On Windows, run `type %userprofile%\.ssh\id_ed25519.pub | clip`. On MacOS, run `pbcopy < ~/.ssh/id_ed25519.pub`. This automatically copies the public key. If any errors arise you could ask AI to help you download those tools.
6. Add your Public SSH Key to [GitHub SSH Settings](https://github.com/settings/ssh/new) by simply pasting ctrl+V or command+V. Leave it as an authentication key. and save.
7. Test the connection by running `ssh -T git@github.com` in your terminal or command prompt. Verify that the resulting message contains your username.

Check out [common SSH problems](https://docs.github.com/authentication/troubleshooting-ssh) for more help. You can also check [GitHub's SSH docs](https://docs.github.com/en/authentication/connecting-to-github-with-ssh).
