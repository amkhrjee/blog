import { Context, Hono } from "@hono/hono";
import { cors } from "@hono/hono/cors";
import { stream } from "@hono/hono/streaming";
import { Client } from "https://deno.land/x/postgres@v0.19.3/mod.ts";
import { CSS, render } from "@deno/gfm";
import { MongoClient, ServerApiVersion } from "npm:mongodb@6.8.0";
import formData from "npm:form-data@4.0.0";
import Mailgun from "npm:mailgun.js@10.2.1";
import { load } from "https://deno.land/std@0.224.0/dotenv/mod.ts";

// Environment variables
const env = await load();

// PostgreSQL for blog posts
const client = new Client({
  user: "postgres",
  database: "postgres",
  password: "verylongpassword",
  hostname: "posts_db",
  port: 5432,
});
await client.connect();

// MongoDB for newsletter subscribers
const mongo_uri = "mongodb://172.18.0.1:27017/";
//@ts-ignore:Deno can't figure out the type here for some reason
const mongo_client = new MongoClient(mongo_uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  // tls: true,
});
const mongo_db_name = "blog";
const mongo_collection_name = "subscribers";
await mongo_client.connect();
const newsletter_collection = mongo_client
  .db(mongo_db_name)
  .collection(mongo_collection_name);

// Sending a confirmation email
//@ts-ignore: Mailgun.js doesn't come with types apparently
const mailgun = new Mailgun(formData);
const mg = mailgun.client({
  username: "api",
  key: env["MAILGUN_API_KEY"],
});

const app = new Hono();
app.use("/", cors());
app.get("/", (c: Context) =>
  c.html("api server for https://blog.amkhrjee.xyz!")
);

app.post("/", async (c: Context) => {
  console.log("Received POST Request");
  const fileName = c.req.header("Content-Disposition");
  console.log(`File Name: ${fileName}`);
  const arrayBuff = await c.req.arrayBuffer();
  console.log("Array Buffer Received. Writing to disk.");
  try {
    await Deno.writeFile(`./images/${fileName}`, new Uint8Array(arrayBuff));
    console.log("Image saved to disk.");
  } catch (err) {
    {
      console.error("Failed to write image to disk.");
      return c.json({
        status: "failure",
        error: err,
      });
    }
  }

  return c.json({
    status: "success",
  });
});

app.get("/image/:path", async (c: Context) => {
  console.log("RECEIVED GET REQUEST FOR IMAGE");
  const image = c.req.param("path");
  let file;
  try {
    file = await Deno.open("./images/" + image, { read: true });
  } catch (err) {
    console.log(`Could not read ${image} for ${err}`);
    return c.text("Resource not found", 404);
  }

  const readableStream = file.readable;

  return stream(c, async (stream) => await stream.pipe(readableStream));
});

app.use("/latest", cors());
app.get("/latest", async (c: Context) => {
  console.log("Received GET request on /latest");
  console.log("Fetching latest posts...");
  // deno-lint-ignore no-explicit-any
  const result: any = await client.queryObject(
    "SELECT title, tags, summary, slug FROM posts ORDER BY last_modified DESC LIMIT 5"
  );
  console.log("Fetched rows from posts table");
  let html = "";
  const rows: { title: string; tags: string; summary: string; slug: string }[] =
    result.rows;

  for (const { title, tags, summary, slug } of rows) {
    const tags_list = tags.substring(1, tags.length - 1).split(",");
    html += `
    <div class="card mx-4 shadow-md">
      <div class="card-body">
        <div class="card-title flex-col items-start">
          <h2 class="font-sans">${title}</h2>
          <div class="flex gap-1 overflow-x-auto w-full text-sm font-mono">
    `;
    for (const tag of tags_list) {
      html += `<div class="badge">${tag}</div>`;
    }
    html += `
          </div>
        </div>
      <p>
        ${summary} 
      </p>
      <div class="card-actions justify-end">
        <a href="/posts/${slug}" class="cursor-pointer link-primary">Read more</a>
      </div>
      </div>
    </div>
      <br/>
    `;
  }
  console.log("Sending HTML Cards as Response");
  console.log("------------------");

  //@ts-ignore: type StatusCode doesn't include 286, but is required for HTMX
  return c.html(html, 286);
});

app.use("/posts/*", cors());
app.get("/posts/:slug", async (c: Context) => {
  const slug = c.req.param("slug");
  console.log("RECEIVED REQUEST FOR " + slug);

  // deno-lint-ignore no-explicit-any
  const result: any = await client.queryObject(
    `SELECT title, tags, content, last_modified FROM posts WHERE slug='${slug}'`
  );
  const rows: {
    title: string;
    tags: string;
    content: string;
    last_modified: Date;
  }[] = result.rows;
  const row = rows[0];
  const markdownHTML = render(row.content, {
    baseUrl: "",
  });
  const tags_list = row.tags.substring(1, row.tags.length - 1).split(",");

  let html = `
    <!-- Blog Content -->
    <style>${CSS}</style>
    <div class="container prose px-6">
      <h1>${row.title}</h1>
      <div class="flex gap-2 flex-wrap w-full text-sm font-mono">
      `;
  for (const each_tag of tags_list) {
    html += `<div class="badge">${each_tag}</div>`;
  }
  html += `  
      </div>
      <div class="font-serif">
        ${markdownHTML}
      </div>
    </div>
    <!-- Date -->
    <div class="px-6">
      <p>Posted on: 23 Jun 2024</p>
    </div>
  `;

  return c.html(html);
});

app.use("/tags/*", cors());
app.get("/tags", async (c: Context) => {
  console.log("Received request for /tags");
  // deno-lint-ignore no-explicit-any
  const response: any = await client.queryArray(
    "SELECT UNNEST(ENUM_RANGE(NULL, NULL::tags))"
  );
  const tags = response.rows;
  let html = ``;
  for (const [each_tag] of tags) {
    html += `<div class="tag badge badge-outline cursor-pointer mr-2">${each_tag}</div>`;
  }
  html += `
    <script>
      const tags_list = document.querySelectorAll(".tag");
      let active_tags = new Set([]);
      const posts = document.getElementById("posts");
      const mObserver = new MutationObserver(async () => {
      let response;
        if (active_tags.size > 0)
          response = await fetch(\`http://api:8000/tags/\${[...active_tags].join("+")}\`);
        else
          response = await fetch("http://api:8000/notags");
        const body = await response.text();
        posts.innerHTML = body;        
      });
      for (const each_tag of tags_list) {
        mObserver.observe(each_tag, { attributes: true, attributeFilter: ["class"] });
        each_tag.addEventListener("click", () => {
          if (active_tags.has(each_tag.textContent)) {
            each_tag.classList.add("badge-outline");
            each_tag.classList.remove("badge-accent");
            active_tags.delete(each_tag.textContent);
          } else {
            each_tag.classList.remove("badge-outline");
            each_tag.classList.add("badge-accent");
            active_tags.add(each_tag.textContent);
          }
        });
      }
    </script>
  `;
  return c.html(html);
});

app.use("/all/*", cors());
app.get("/all/desc", async (c: Context) => {
  console.log("RECEIVED REQUEST FOR ALL POSTS IN DESC ORDER");
  // deno-lint-ignore no-explicit-any
  const result: any = await client.queryObject(
    "SELECT title, summary, slug, last_modified FROM posts ORDER BY last_modified DESC"
  );
  let html = "";
  const rows: {
    title: string;
    summary: string;
    slug: string;
    last_modified: string;
  }[] = result.rows;
  for (const { title, summary, slug, last_modified } of rows) {
    html += `
    <h3><a class="link link-primary" href="/posts/${slug}">${title}</a></h3>
    <time>${new Date(last_modified).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    })}</time>
    <p>${summary}</p>`;
  }
  //@ts-ignore: type StatusCode doesn't include 286, but is required for HTMX
  return c.html(html, 286);
});

app.get("/all/asc", async (c: Context) => {
  console.log("RECEIVED REQUEST FOR ALL POSTS IN ASC ORDER");
  // deno-lint-ignore no-explicit-any
  const result: any = await client.queryObject(
    "SELECT title, summary, slug, last_modified FROM posts ORDER BY last_modified ASC"
  );
  let html = "";
  const rows: {
    title: string;
    summary: string;
    slug: string;
    last_modified: string;
  }[] = result.rows;
  for (const { title, summary, slug, last_modified } of rows) {
    html += `
    <h3><a class="link link-primary" href="/posts/${slug}">${title}</a></h3>
    <time>${new Date(last_modified).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    })}</time>
    <p>${summary}</p>`;
  }
  //@ts-ignore: type StatusCode doesn't include 286, but is required for HTMX
  return c.html(html, 286);
});

app.get("/tags/:list", async (c: Context) => {
  const tags_param = c.req.param("list");
  const tags: string[] = tags_param.split("+");
  console.log(tags);
  const quotes_tags = tags.map((tag) => `'${tag}'`);
  // deno-lint-ignore no-explicit-any
  const result: any = await client.queryObject(`
      SELECT title, last_modified, summary, tags, slug FROM posts WHERE tags @> ARRAY[${quotes_tags.join(
        ","
      )}]::tags[]
    `);
  if (result.rowCount === 0) {
    return c.html("<h4 class='text-center'>No posts found 🤷🏻‍♂️</h4>");
  }

  const rows: {
    title: string;
    last_modified: string;
    summary: string;
    tags: string;
    slug: string;
  }[] = result.rows;
  let html = "";
  for (const { title, last_modified, summary, tags, slug } of rows) {
    const tags_list = tags.substring(1, tags.length - 1).split(",");

    html += `
    <h3><a class="link link-primary" href="/posts/${slug}">${title}</a></h3>
    <div><time>${new Date(last_modified).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    })}</time></div>
    `;
    for (const tag of tags_list) {
      html += `<div class="badge">${tag}</div>`;
    }
    html += `
    <p>${summary}</p>`;
  }
  return c.html(html);
});

app.use("/notags", cors());
app.get("/notags", (c) => {
  return c.html(
    "<h4 class='text-info text-center'>Select tags to show the corresponding posts.</h4>"
  );
});

// Newsletter stuff
app.use("/newsletter/*", cors());
app.post("/newsletter/sub", async (c: Context) => {
  const { email, date } = await c.req.json();
  console.log(
    `${email} received on ${new Date(date).toLocaleDateString("en-GB")}`
  );

  const email_exists = await newsletter_collection.findOne({ email: email });
  if (!email_exists) {
    newsletter_collection.insertOne({
      email: email,
      date_of_sub: date,
      is_subbed: true,
      emails_received_count: 0,
    });

    mg.messages
      .create("blog.amkhrjee.xyz", {
        from: "Aniruddha Mukherjee <newsletter@blog.amkhrjee.xyz>",
        to: [email],
        subject: "Aniruddha's Blog Subscription Confirmation",
        html: `
      <p>
          <strong>Thanks for subscribing to the my blog's newsletter!</strong>  
        </p>
        <br/>
        <p>If this email has landed on your spam box, please mark it as 'Not Spam'. If that's not the case, no action is required from you.</p>
        <p>You'll receive my new posts right in your inbox :)</p>
        <br/>
        <p>
          <em>Have a great day!</em>
        </p>
        <p>
          Aniruddha Mukherjee
          </p>
          <p><a href="https://amkhrjee.xyz">amkhrjee.xyz</a></p>
          <br/>
          <p>P.S. If you subscribed by mistake, you can <a href="https://blog.amkhrjee.xyz/unsubscribe.html">unsubscribe</a>.</p>
          `,
      })
      // deno-lint-ignore no-explicit-any
      .then((msg: any) => console.log(msg)) // logs response data
      // deno-lint-ignore no-explicit-any
      .catch((err: any) => console.log(err)); // logs any error
  }
  return c.text("success", 200);
});

app.post("/newsletter/unsub", async (c: Context) => {
  const formData = await c.req.formData();
  const email = formData.get("email");
  console.log(`Unsubscription Request from email: ${email}`);

  await newsletter_collection.updateOne(
    { email: email },
    { $set: { is_subbed: false } }
  );

  return c.html(
    `
    <div style="padding: 4rem;font-family: sans-serif;">
      <h1>You've been unsubscribed!</h1>
      <h2>Go back to <a href='https://blog.amkhrjee.xyz/'>Home</a></h2>
    </div>
    `
  );
});

app.get("/newsletter/sublist", async (c: Context) => {
  const findResults = newsletter_collection
    .find({ is_subbed: true })
    .project({ _id: 0, email: 1 });
  const emails: string[] = [];
  for await (const doc of findResults) {
    emails.push(doc.email);
  }
  console.log(emails);

  return c.json({
    emails: emails,
  });
});

app.get("/newsletter/newpost", async (c) => {
  console.log("SENDING OUT NEWSLETTER TO ALL SUBS");
  const findResults = newsletter_collection
    .find({ is_subbed: true })
    .project({ _id: 0, email: 1 });
  const emails: string[] = [];
  for await (const doc of findResults) {
    emails.push(doc.email);
  }

  // deno-lint-ignore no-explicit-any
  const result: any = await client.queryArray(`
    SELECT title, content FROM posts ORDER BY id DESC LIMIT 1`);
  const post: [title: string, content: string] = result.rows[0];
  const [title, content] = post;
  const markdown_html = render(content, {
    baseUrl: "",
  });

  emails.forEach((email) => {
    mg.messages
      .create("blog.amkhrjee.xyz", {
        from: "Aniruddha Mukherjee <newsletter@blog.amkhrjee.xyz>",
        to: [email],
        subject: title,
        html: `
          ${markdown_html}
          <br/>
          <p>You received this email because you are subscribed to <a href="https://blog.amkhrjee.xyz">Aniruddha's Blog</a>.</p>
          <p>If you no longer wish to receive these emails, you can unsubscribe <a href="https://blog.amkhrjee.xyz/unsubscribe.html">here</a>.</p>
        `,
      })
      // deno-lint-ignore no-explicit-any
      .then((msg: any) => console.log(msg)) // logs response data
      // deno-lint-ignore no-explicit-any
      .catch((err: any) => console.log(err)); // logs any error
  });

  return c.text("success");
});

Deno.serve(app.fetch);
